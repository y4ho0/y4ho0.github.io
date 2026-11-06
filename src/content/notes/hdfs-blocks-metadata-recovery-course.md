---
title: "HDFS 从文件读写到故障恢复：块、副本与元数据的一条完整链路"
description: "连接块与副本、NameNode 与 DataNode、写入管道、心跳、块报告、FsImage/EditLog 及检查点。"
updatedAt: 2026-10-27
tags: ["HDFS", "Fault Tolerance", "Replication", "NameNode"]
status: growing
draft: true
course: distributed-data-systems
---

HDFS 在普通硬件构成的集群上提供统一文件命名空间。它强调大文件的顺序访问、批量吞吐以及节点故障后的恢复，不追求与本地 POSIX 文件系统完全一致的随机读写语义。

理解 HDFS 时，应该沿着一个文件从创建、读取到节点故障的过程，把不同组件的作用联系起来。

## 文件为什么要拆成 Block？

假设文件有 300 MiB，块大小为 128 MiB，可以分为约 128、128、44 MiB 三个逻辑块。最后一个块不足 128 MiB，不意味着底层需要人为填满 128 MiB 的有效数据。

较大的数据块有利于减少元数据管理开销，支持顺序读取；块可以在不同 DataNode 上放置并复制。NameNode 必须保存文件和 Block 的对应信息，但文件内容本身不放在 NameNode 中。

:term[数据块副本]{note="同一个逻辑块在不同 DataNode 上保存的冗余数据。实际可用副本数依赖集群规模、健康状态、复制配置和位置策略。"}与“备份整个文件系统”不是同一概念；副本丢失后能否恢复，还取决于是否存在可用源副本。

## 一次读操作的主要路径

~~~text
Client -- open(path) --> NameNode
Client <-- block locations -- NameNode
Client -- read block --> DataNode
Client <-- block bytes -- DataNode
~~~

NameNode 提供文件到块、块到可用副本的元数据信息，客户端直接与合适的 DataNode 传输文件内容。这样 NameNode 不需要承担全量文件数据流的带宽。

## 一次写操作的主要路径

客户端先申请创建逻辑路径，再按副本放置策略获得写入目标，与 DataNode 形成 pipeline 进行数据包传输、确认与文件完成。

:::prototype{title="HDFS 数据管道交互演示" href="/demos/hdfs-write/"}
逐步观察客户端与 NameNode 建立元数据记录，再向 DataNode 管道发送数据以及接收确认的过程。这是教学原型，不连接真实集群。
:::

如果遇到部分 DataNode 不可用，写入管道可能需要调整。具体重试与一致性由协议和实现控制，不能将“存在三个 DataNode”直接等同于“任意三次故障都不影响写入”。

## 谁知道哪些数据块还存活？

DataNode 会向 NameNode 发送心跳和 Block Report（块报告）。心跳说明节点活跃状态，块报告提供持有块的信息。

某个节点失联以后，NameNode 根据故障判定规则修改可用性；若块副本不足并且还有健康源副本与空闲存储节点，可以安排额外复制。

在单机伪分布式环境中，DataNode 可能只有一个。即使副本目标设为 3，也没有条件验证跨不同物理机器的容错效果。

## NameNode 断电之后还能恢复吗？

正常运行时，NameNode 在内存中维护命名空间；持久化方面主要涉及 FsImage（命名空间检查点镜像）与 EditLog（编辑日志）。

~~~text
FsImage 检查点
     +
检查点之后提交的编辑日志
     |
     v
重建命名空间的内存状态
     |
DataNode 心跳与块报告
     |
     v
获得运行时的块位置信息
~~~

:term[Checkpoint]{note="对一致的元数据状态生成检查点，用于减少重启恢复时需要重放的日志。它不是让另一台机器自动接管 NameNode 的高可用机制。"}的目的在于管理恢复成本，而不是直接保存 HDFS 文件内容。

SecondaryNameNode 在经典配置下参与 Checkpoint，**并非热备 NameNode**。HDFS HA 的 Active/Standby NameNode 是独立的架构设计。

## 为什么小文件会影响 NameNode？

一个 1 KiB 的文件不必物理占满 128 MiB 块，但仍需要文件元数据、块相关信息及目录结构对象。大量独立文件会增加 NameNode 的元数据规模和 JVM 内存压力。

这种持续存活的业务元数据不等于内存泄漏。只有元数据无业务必要却仍被错误引用时，才可能谈到泄漏问题。

## 真实验证与尚未验证的内容

已有记录：Ubuntu 16.04 + Hadoop 2.7.1 的伪分布式环境能够执行目录创建、文件上传、下载、读取和重命名；曾观察到 NameNode、DataNode、SecondaryNameNode 进程。

可继续使用只读命令验证：

~~~bash
hdfs dfsadmin -report
hdfs fsck /user/hadoop/experiment2/moved.txt -files -blocks -locations
~~~

实际路径需先确认存在。当前没有可引用的 fsck 块位置实测结果，也尚未在多机环境注入节点故障，因此不声称副本恢复已完成验证。

特别注意：对现有环境执行 namenode -format 不是日常故障恢复手段，可能破坏已有命名空间。

## 来源

讲义内容：《云计算与大数据》第 3 章 HDFS 架构、读写、数据保护；第 7 章 HDFS HA 与 Federation 的历史发展。部分简化流程由 [Hadoop 2.7.1 HDFS Architecture](https://hadoop.apache.org/docs/r2.7.1/hadoop-project-dist/hadoop-hdfs/HdfsDesign.html)核对。

深入阅读可继续关联已有专题《NameNode 的元数据为什么既在内存里，又有 FsImage 和 EditLog？》与《为什么 HDFS 不喜欢海量小文件？》。
