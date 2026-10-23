---
title: "NameNode 的元数据为什么既在内存里，又有 FsImage 和 EditLog？"
description: "沿着一次文件创建和一次故障恢复，理解 HDFS 命名空间、持久化日志、检查点及 SecondaryNameNode 的职责。"
updatedAt: 2026-10-23
tags: ["HDFS", "NameNode", "FsImage", "EditLog", "Recovery"]
status: growing
draft: true
course: distributed-data-systems
related:
  - collection: notes
    entry: hdfs-read-write-replication
  - collection: notes
    entry: hdfs-small-files-cost
---

HDFS 的文件操作有一个容易让人困惑的地方：FsImage 不是每次操作后立即更新，为什么新创建的文件却能被其他客户端马上查到？如果此时 NameNode 断电，内存里的元数据又如何恢复？

这两个问题其实共同指向 NameNode 的元数据设计：**内存负责在线服务，EditLog 记录修改，FsImage 提供持久化检查点。**

以下以 Hadoop 2.7.x 的经典 HDFS 架构为讨论范围，避免把旧版本实现等同于所有 Hadoop 发行版。

## 三份状态并非三套独立的文件系统

可以将 NameNode 需要管理的信息分成三个视角：

| 载体 | 主要作用 | 是否代表当前状态 |
| --- | --- | --- |
| NameNode 内存中的命名空间 | 在线查询和更新文件系统元数据 | 正常运行时维护当前状态 |
| FsImage | 磁盘上的命名空间检查点 | 可能落后于当前状态 |
| EditLog | 持久化记录检查点之后的元数据事务 | 与 FsImage 共同支持恢复 |

NameNode 管理文件路径、目录层次、权限、文件与块的映射等信息。文件内容本身存储在 DataNode 的数据块里，而不是 FsImage 里。

还要注意一个实现细节：**数据块与 DataNode 的当前对应位置，需要依赖 DataNode 的心跳及块报告维护，不能把 FsImage 当作存有所有运行时块位置的完整内存镜像。**

## 创建 c.txt 后，FsImage 仍是旧的，为什么能查到？

假设某次检查点时，命名空间有两个文件：

~~~text
FsImage：
  /a.txt
  /b.txt
~~~

之后客户端请求创建 /c.txt。NameNode 对在线命名空间进行修改，并将对应事务记录到 EditLog。新的检查点还没有生成时，状态可以示意为：

~~~text
NameNode 内存           EditLog              FsImage
/a.txt                  创建 /c.txt          /a.txt
/b.txt                                       /b.txt
/c.txt
~~~

这里的示意强调**三个载体的角色**，并不表示事务写日志与更新内存的严格先后顺序；实际操作必须遵循实现中的同步和持久化规则。

另一个客户端此时请求列目录，访问的是正在提供服务的 NameNode 命名空间，因此可以看到 /c.txt。它并不需要等待 SecondaryNameNode 创建下一份 FsImage。

对于正在写入的数据文件，还需要单独讨论“目录项已存在”和“文件内容对其他读取者已经可见”的区别；文件关闭、hflush()、hsync() 以及客户端写入协议会影响数据可见性，不能仅凭目录查询推断全部字节已可读取。

## 为什么不每次都重写 FsImage？

把完整命名空间重新序列化成磁盘快照，通常比记录一个小型元数据事务代价更高。

如果每次 mkdir、rename 或权限修改都要重写整个 FsImage，随着目录和文件数量增长，操作成本会变得不合理。于是采用：

1. 启动时加载持久化状态，构建内存命名空间；
2. 在线执行元数据操作，并把修改写入持久化日志；
3. 定期生成检查点，避免必须无限重放很长的日志。

这是一种**快照 + 日志**的恢复思路，不意味着所有目录项、权限和数据块对象都在磁盘上按原样复制成 Java 对象。

## SecondaryNameNode 究竟在做什么？

SecondaryNameNode 的名字特别容易误导。它**不是备用 NameNode**，不能因为主 NameNode 宕机就自动接管全部请求。

在经典非 HA（High Availability，高可用性）配置中，它承担检查点（Checkpoint）相关工作。简化流程：

~~~text
NameNode                 SecondaryNameNode
 FsImage  -------------------->
 EditLog  -------------------->
                                 加载快照
                                 重放日志
                                 生成新 FsImage
 新检查点 <---------------------
~~~

实际运行中还涉及滚动编辑日志等步骤，以便在线写操作和检查点协同进行。

检查点减轻的是**重启时重放历史修改的成本**，并不是把“实时修改同步给所有 DataNode”。DataNode 存放数据块，不负责替 NameNode 维护文件系统命名空间。

高可用配置下则有 Active/Standby NameNode 等不同组件及共享编辑日志机制，不能把 SecondaryNameNode 直接当作 Standby。

## 如果突然断电，会失去哪些信息？

断电意味着进程内存消失，NameNode 的整个内存命名空间都需要重新建立；不是“只丢失新修改的 Java 对象”。

重新启动时，NameNode 从可用的 FsImage 与 EditLog 恢复命名空间：

~~~text
旧 FsImage
    +
其后的 EditLog 事务
    |
    v
加载、重放、恢复命名空间
    |
    v
DataNode 重新报告块信息
    |
    v
对外恢复正常服务
~~~

如果持久化文件完整，已按协议成功提交的元数据修改可以通过日志恢复。倘若存储本身损坏、日志缺失或发生其他故障，则不能仅凭这张流程图保证所有信息都恢复。

所以需要把三个概念拆开：

- **内存丢失**：进程一旦退出，Java 对象不再存在；
- **磁盘持久化**：FsImage 和 EditLog 用于重建命名空间；
- **数据块保留**：文件实际内容仍取决于 DataNode 的块存储及其健康状态。

## 为什么 NameNode 的 Java 堆可能很大？

NameNode 为了高效处理目录查找和块管理，需要将大量活跃元数据维护在内存中。这些状态在 JVM（Java Virtual Machine，Java 虚拟机）里以对象、引用和数据结构表现。

例如，一个文件不仅有名字，还涉及目录树中的位置、权限、块引用等；大量文件意味着大量必须保持可达的对象。

这不等于内存泄漏（Memory Leak）。**文件及块仍存在，系统就需要持续保留相应元数据。** 当相关文件被删除，且不再有业务引用或其他保留原因时，相应对象才可能由 GC（Garbage Collection，垃圾回收）回收。

FsImage 是序列化的持久化结构，不是 JVM 堆的一比一内存转储。因此两者所占空间不必相同，磁盘文件通常也不能作为 NameNode 堆使用量的直接估算值。

这解释了为何 HDFS 的 NameNode 压力更接近于**文件、目录、块与相关对象数量**，而不是仅取决于总数据量是多少 TB。

## 可以怎样验证，而不是只看架构图？

已经完成的伪分布式实验中，jps 能确认 NameNode、DataNode 和 SecondaryNameNode 三类进程存在，但没有直接观察过某次 Checkpoint 的文件变化。

下一步可安排**只读验证**：

~~~bash
cd /usr/local/hadoop
./bin/hdfs getconf -confKey dfs.namenode.name.dir
./bin/hdfs dfsadmin -report
~~~

第一条查询 NameNode 的元数据存储目录配置，第二条查看集群 DataNode 状态。获得实际目录后，才考虑使用 Hadoop 2.7.1 的 Offline Image Viewer（离线镜像查看工具）分析检查点内容。不要对元数据目录进行修改，也不要将 namenode -format 当作重启故障的修复手段。

<!-- 待补：实际 fsimage / edits 文件列表、时间戳及只读查看器的验证截图。尚未运行这些检查，本文不声称观察到了真实检查点差异。 -->

## 小结

“FsImage 尚未更新，其他客户端能否看到新文件”并不矛盾：在线服务依赖 NameNode 维护的当前命名空间，而 FsImage 负责检查点；EditLog 则承担检查点之后的持久化事务记录。

SecondaryNameNode 主要是检查点组件，不是热备接管节点。真正理解这些分工后，NameNode 断电恢复、元数据内存压力以及 HDFS 小文件问题才有了共同的解释框架。

## 参考资料

- [Apache Hadoop 2.7.1 — HDFS Architecture](https://hadoop.apache.org/docs/r2.7.1/hadoop-project-dist/hadoop-hdfs/HdfsDesign.html)
- [Apache Hadoop 2.7.1 — Offline Image Viewer](https://hadoop.apache.org/docs/r2.7.1/hadoop-project-dist/hadoop-hdfs/HdfsImageViewer.html)
- [Apache Hadoop 2.7.1 — High Availability](https://hadoop.apache.org/docs/r2.7.1/hadoop-project-dist/hadoop-hdfs/HDFSHighAvailabilityWithQJM.html)

> **草稿待验证：** 编辑日志与检查点文件的实际目录、生成时机和只读检查结果；未完成前不发布成“源码级实现解析”。
