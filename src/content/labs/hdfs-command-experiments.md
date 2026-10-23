---
title: "HDFS 文件操作实验：把本地路径与分布式命名空间分开验证"
description: "在 Hadoop 2.7.1 伪分布式环境中，对目录创建、上传、读取、下载、重命名与数据块检查建立一套可复现且不破坏原始数据的实验流程。"
updatedAt: 2026-10-23
tags: ["HDFS", "Hadoop", "Linux", "Lab"]
status: growing
draft: true
course: distributed-data-systems
---

一台 Hadoop 伪分布式虚拟机可以同时提供 Linux 本地文件系统和 HDFS。二者的命令看起来相似，但文件路径、命名空间及数据流向并不相同。

既有记录已经完成 HDFS 目录创建、-put、-get、-ls、-cat 和 -mv 等基本操作。为便于后续复现，这里将观察内容与复现步骤分开记录，避免把计划中的 fsck、节点报告或性能测试写成既有实验结果。

## 环境与假设

曾经核对的环境：

| 项目 | 已有记录 |
| --- | --- |
| 客户机 | Ubuntu Kylin 16.04 |
| Java | OpenJDK 1.8.0_131 |
| Hadoop | 2.7.1 |
| 部署模式 | 单机伪分布式 |
| 已观察到的进程 | NameNode、DataNode、SecondaryNameNode |
| 使用方式 | 从 macOS Terminal 经 SSH 操作 |

这里的“伪分布式”意味着关键服务以独立进程运行，但没有多台物理机器的故障隔离。

## 操作一：检查当前服务

先在 Ubuntu 终端执行：

~~~bash
cd /usr/local/hadoop
jps
./bin/hdfs dfsadmin -report
./bin/hdfs getconf -confKey fs.defaultFS
~~~

第一条列出当前 Java 进程；第二条查看 DataNode 状态；第三条尝试查看默认文件系统属性。不同 Hadoop 命令对配置键的接受方式可能存在区别，必要时直接检查 core-site.xml 中的 fs.defaultFS；不能将命令异常当成文件系统故障。

**实验记录栏（待补真实输出）**：当前 NameNode 与 DataNode 数量、默认文件系统 URI。

## 操作二：在独立目录中创建输入文件

为了避免覆盖已有实验文件，使用独立目录：

~~~bash
mkdir -p /home/hadoop/garden-hdfs-lab
printf 'alpha beta\nalpha gamma\n' > /home/hadoop/garden-hdfs-lab/input.txt
./bin/hdfs dfs -mkdir -p /user/hadoop/garden-hdfs-lab
./bin/hdfs dfs -put /home/hadoop/garden-hdfs-lab/input.txt /user/hadoop/garden-hdfs-lab/
~~~

本地路径是 /home/hadoop/garden-hdfs-lab/input.txt，HDFS 路径是 /user/hadoop/garden-hdfs-lab/input.txt。-put 才是两套文件系统之间的复制动作。

如果目标文件已经存在，-put 应拒绝直接覆盖，避免误以为此前内容自然被替换。需要重复实验时使用新目录或显式确认版本。

> 上面的输入文本是可复现实验的**新设计样本**，并非此前实验的原始文本。执行输出尚未采集。

## 操作三：读取与重命名

~~~bash
./bin/hdfs dfs -ls /user/hadoop/garden-hdfs-lab
./bin/hdfs dfs -cat /user/hadoop/garden-hdfs-lab/input.txt
./bin/hdfs dfs -mv /user/hadoop/garden-hdfs-lab/input.txt /user/hadoop/garden-hdfs-lab/renamed.txt
./bin/hdfs dfs -ls /user/hadoop/garden-hdfs-lab
./bin/hdfs dfs -cat /user/hadoop/garden-hdfs-lab/renamed.txt
~~~

这里应核对的不是“命令没有报错”这么简单，而是：改名前后的逻辑路径不同、原路径不再存在、重命名后的内容与原输入一致。

注意 -mv 更改的是 HDFS 命名空间中的路径；它不会自动修改 Linux 本地的 input.txt。

## 操作四：下载到本地并验证一致性

~~~bash
./bin/hdfs dfs -get /user/hadoop/garden-hdfs-lab/renamed.txt /home/hadoop/garden-hdfs-lab/from-hdfs.txt
cat /home/hadoop/garden-hdfs-lab/from-hdfs.txt
cmp /home/hadoop/garden-hdfs-lab/input.txt /home/hadoop/garden-hdfs-lab/from-hdfs.txt
~~~

cmp 无输出且退出码为零，表示两个文件逐字节相同。这里的验证强于只看目录列表，因为它比较了真正的文件内容。

如果输出文件已存在，先检查文件而不是使用覆盖参数。这样不会误删原始实验结果。

## 操作五：查看块位置（待执行）

~~~bash
./bin/hdfs fsck /user/hadoop/garden-hdfs-lab/renamed.txt -files -blocks -locations
~~~

这可以作为 NameNode 与 DataNode 元数据关系的进一步证据。后续需要保存 Block 数量、实际位置及副本配置，并明确是否只有一个 Live DataNode。

该命令尚未有记录中的真实输出，**不能声称已经完成多节点副本验证**。

## 不建议直接执行的危险操作

~~~text
hdfs namenode -format
~~~

这不是日常排障的“重置按钮”。对已经投入使用的 HDFS 元数据重新格式化，可能导致已有文件系统命名空间丢失或不可用。实验需要重新建集群时，应在隔离且备份完善的新环境中进行，而不是对原虚拟机直接尝试。

同样，不建议为了“验证容错”直接删除 DataNode 存储目录；应先完成多节点环境搭建并设计故障恢复实验。

## 实验结果与待补证据

**历史已完成的能力**：HDFS 基础创建、上传、下载、读取、重命名。**新设计、尚待复现的能力**：独立目录下的字节级 cmp 验证、fsck 块位置、DataNode 状态报告。

发布前应增加终端截图、实际命令输出、运行日期、配置版本与错误处理记录。只有真实执行并留下证据后，才能把待执行步骤转为“已验证”。

## 参考资料

- 《云计算与大数据》：第 2、3 章与 HDFS 基础操作实验。
- [Apache Hadoop 2.7.1 — File System Shell](https://hadoop.apache.org/docs/r2.7.1/hadoop-project-dist/hadoop-common/FileSystemShell.html)
- [Apache Hadoop 2.7.1 — HDFS Architecture](https://hadoop.apache.org/docs/r2.7.1/hadoop-project-dist/hadoop-hdfs/HdfsDesign.html)
