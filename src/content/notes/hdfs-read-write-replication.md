---
title: "HDFS 读写为什么先找 NameNode，数据却从 DataNode 传输？"
description: "沿着客户端读取和写入文件的请求路径，解释元数据查询、数据管道、块副本、故障处理与单机伪分布式的验证边界。"
updatedAt: 2026-10-23
tags: ["HDFS", "NameNode", "DataNode", "Replication"]
status: growing
draft: true
course: distributed-data-systems
---

在 HDFS 中执行 -cat 或 -put，面对的都只是一个文件路径。后台却涉及两类完全不同的交互：**向 NameNode 询问元数据，以及与 DataNode 交换文件内容**。

分开理解它们，就能回答“文件名究竟存在哪里”“NameNode 是否经手所有数据”以及“节点宕机后文件怎样恢复”等问题。

## 读取：NameNode 提供位置，不转发整个文件

简化后的顺序如下：

~~~text
客户端            NameNode             DataNode
  |  open(path)      |                    |
  |----------------->|                    |
  |  块及副本位置     |                    |
  |<-----------------|                    |
  |                 read(block)           |
  |------------------------------------->|
  |                  数据流                |
  |<-------------------------------------|
~~~

客户端首先查询逻辑路径对应的文件块和可用副本，然后根据位置选择适当 DataNode 读取，必要时跨多个块继续读取。

不能理解为“客户端一直和 NameNode 保持连接，NameNode 再从磁盘把文件发回来”。NameNode 保存管理元数据，数据传输通常绕开它，减轻中心节点成为数据带宽瓶颈的风险。

真实实现还涉及文件校验、可用副本选择、网络距离及失败重试。流程图仅保留决定路径的主要交互。

## 写入：先建立文件，再形成数据管道

写入时，客户端向 NameNode 请求创建文件并取得写入约束，随后将数据拆成 packets，通过 DataNode 的写入 pipeline 传输。

假设集群配置了多个副本，管道可能是：

~~~text
Client  --> DataNode A --> DataNode B --> DataNode C
  ^           |               |               |
  +-----------+---------------+---------------+
               确认沿管道返回
~~~

各节点存储数据、校验并沿管道传播确认。NameNode 管理最终的文件元数据与副本位置；不能将写操作描述成“客户端给 NameNode 发送整个文件，NameNode 再存三份”。

**副本数量和实际拓扑必须区分。** 如果只启动一台 DataNode，即使概念上支持三副本，也无法据此推断已经具有跨机器三副本容错能力。具体副本设置可查询：

~~~bash
cd /usr/local/hadoop
./bin/hdfs getconf -confKey dfs.replication
~~~

查询配置是一回事，确认每个块的实际可用副本则需要另外查看文件块信息。

## HDFS 如何发现失败的 DataNode？

DataNode 会向 NameNode 发送心跳和块报告。心跳用于反映存活状态，块报告用于描述持有的块。

NameNode 发现某节点长期不可用后，可以避免继续将新请求发往该节点；如果某些块的实际副本数不足，还可能调度副本补足。这里的重新复制依赖**至少仍有健康的源副本和可用目标节点**，不是无中生有地恢复已全部丢失的数据。

网络分区可能造成“节点暂时不可访问”而非真正永久损坏，故障判定、复制与恢复需要遵循系统的超时和状态规则。

## 为什么数据块不是文件系统最小的真实磁盘占用？

HDFS 使用较大的逻辑块大小，目的在于减少元数据和寻址成本、方便大规模顺序读写。文件末尾不足整块时，不代表 DataNode 必须为其填充整块空白数据。

块大小、本地文件系统的分配粒度、校验数据与副本数分别属于不同层次，不应在计算空间时混为一谈。

## 如何验证块与副本位置？

已完成的环境中曾成功执行 HDFS 的目录创建、上传、下载、cat 和 mv，但尚未保留 fsck 块分布输出。

下一步可以对一个**已有测试文件**运行只读检查：

~~~bash
cd /usr/local/hadoop
./bin/hdfs fsck /user/hadoop/experiment2/moved.txt -files -blocks -locations
~~~

该命令可报告文件块及位置等信息。它是**待执行的验证步骤**，不能据此声称已经观察到多个不同服务器地址。

如果目录结构已经变化，应先用 hdfs dfs -ls 确认实际路径，不要将旧示例路径直接当作永久存在。

## 总结

NameNode 的职责是管理命名空间和块元数据；DataNode 承担块内容的实际存储和传输；客户端协调两者完成读写。副本机制提供的是在满足拓扑与健康条件下的冗余，单机伪分布式只证明协议和进程运行，并不等于跨机器高可用。

## 参考资料

- 《云计算与大数据》：第 3 章 HDFS 体系结构、数据读写过程、故障恢复。
- [Apache Hadoop 2.7.1 — HDFS Architecture](https://hadoop.apache.org/docs/r2.7.1/hadoop-project-dist/hadoop-hdfs/HdfsDesign.html)

> **待补验证**：当前 dfs.replication 配置、fsck -locations 输出、DataNode 实际数量；未执行故障注入。
