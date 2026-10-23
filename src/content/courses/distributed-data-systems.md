---
title: "云计算与分布式数据系统"
description: "以存储、计算、资源调度和容错为线索理解 Hadoop、HDFS、MapReduce、YARN、HBase 与 NoSQL，并以可复现的 Linux 实验检验关键概念。"
updatedAt: 2026-10-23
tags: ["Distributed Systems", "Hadoop", "HDFS", "MapReduce", "Data Engineering"]
status: growing
draft: true
---

处理海量数据的困难并不只在于数据量大。当存储、网络、计算资源被分散到不同机器上，一次看似简单的读写或统计任务，就必须回答：数据放在哪里、由谁决定访问路径、节点失败之后如何继续、计算任务应如何分配资源？

本课程围绕这些问题构建知识体系。基础材料来自《云计算与大数据》八份讲义，结合 Hadoop 2.7.1 的实际命令行实验、Apache 官方文档和必要的工程补充。**核心目标不是复述讲义，而是形成可以解释机制、推导技术选择并自行验证的知识结构。**

## 六个主题如何联系起来？

~~~text
用户或数据处理程序
         │
         ├── HBase：按键访问和更新大规模记录
         │
         └── MapReduce：描述批量计算任务
                 │
                 v
              YARN：安排计算资源
                 │
                 v
              HDFS：提供分布式文件存储
                 │
                 v
         Linux / 磁盘 / 网络 / 多台机器
~~~

这是一张教学抽象图，并不是说 HBase 的所有读写都必定经过 MapReduce 或 YARN。HBase、MapReduce 是不同的数据访问或处理路径；HDFS 提供底层持久化能力，YARN 负责集群计算资源管理。

课程坚持将**知识模型**与**具体版本实现**分开：Hadoop 1.x 的 JobTracker/TaskTracker 用来解释演进背景；Hadoop 2.7.1 的计算任务则应从 YARN 的 ResourceManager、NodeManager 和 ApplicationMaster 理解。

## 第一部分：为什么需要分布式系统

单机系统容量、计算能力和可靠性存在上限，分布式架构让存储与计算可以跨机器扩展，但也引入网络故障、局部失败和一致性等新问题。

- 分布式与并行不是同一个概念：并行关注同时执行，分布式强调多节点协作。
- 横向扩展不是无限线性加速：数据重分布、网络和协调都可能成为瓶颈。
- “容错”要先定义故障模型：磁盘损坏、进程退出、网络分区带来的后果不同。

阅读目标：能说明何时需要集群，何时一台数据库服务器反而更简单可靠。

## 第二部分：Hadoop 如何划分系统职责

Hadoop 并不是单个数据库。核心组件将文件存储（HDFS）、资源管理（YARN）和批处理编程模型（MapReduce）分离，外部生态系统还包含 Hive、HBase 等独立项目。

理解这部分后，应能解释三种操作为什么走不同的路径：上传文件、提交 WordCount 作业、按行键读取 HBase 记录。

## 第三部分：HDFS 的命名空间、块与恢复

HDFS 客户端面对的是逻辑路径，NameNode 管理命名空间和块元数据，DataNode 保存文件块。

本主题向下延伸四个问题：

1. 为什么同样叫 ls/cat，Linux 与 HDFS 实际访问的对象不同？
2. 读写数据时为什么既要找 NameNode，又要和 DataNode 通信？
3. FsImage、EditLog 和 SecondaryNameNode 各自负责什么？
4. 为什么海量小文件会让 NameNode 承受远超过字节数的压力？

相关的四篇独立笔记与一次虚拟机环境迁移实验已经建立为仓库草稿，随课程继续完善。草稿尚未完成的截图与验证步骤，不会作为已完成事实。

## 第四部分：MapReduce 的数据处理链路

从 WordCount 的键值对变化出发，依次理解 InputSplit、Map、Partition、Shuffle/Sort、Reduce 和输出。

注意：**Shuffle 不是只有网络复制。** Map 端的分区、排序和溢写，Reduce 端的抓取、归并与分组共同构成中间数据处理过程。Combiner 是可选局部聚合，不应改变最终结果的正确性。

## 第五部分：YARN 为什么独立出来

早期 MapReduce 的 JobTracker 同时负责大量调度与管理工作。后来的 YARN 分离集群资源管理和应用程序生命周期管理：ResourceManager 协调全局资源，NodeManager 管理节点上的容器，ApplicationMaster 管理每个应用的任务。

HDFS HA 和 Federation 解决的是**存储层不同的问题**，不能与 YARN 混为一谈。

## 第六部分：从 HBase 到 NoSQL 的存储取舍

HBase 的 RowKey、列族和版本模型适合特定的稀疏、大规模随机读写负载，不等于将 MySQL 表换一个名称。

NoSQL 也不是单一的一致性类别。应区分 ACID 的事务语义、CAP 的网络分区取舍以及不同系统对读取、复制和可用性的具体保证，避免用“关系型 = CP、NoSQL = AP”替代设计分析。

## 实践与文章维护原则

- **已验证**：Ubuntu 16.04、Hadoop 2.7.1 的启动与基础 HDFS 操作，按真实记录描述。
- **待验证**：数据块位置、副本恢复、MapReduce 作业执行、YARN 日志、HBase 部署和性能对比，仅列实验设计，不假设结果。
- **持续更新**：笔记从 seedling 到 growing 再到 evergreen，发布状态与知识成熟度分别管理。
- **引用规范**：官方资料可用于核对，架构图自行绘制；讲义只作为知识来源，不转载原始幻灯片与图片。

## 内容地图（随文章完成逐步扩充）

| 模块 | 主线文章 | 实验或深入研究 |
| --- | --- | --- |
| 系统动机 | 为什么数据处理需要跨机器？ | 故障模型、横向扩展 |
| Hadoop 架构 | HDFS、MapReduce、YARN 到底各管什么？ | 环境迁移 |
| HDFS | 文件读写与副本机制 | 本地文件系统对比、NameNode、FsImage、EditLog、小文件 |
| MapReduce | WordCount 背后的 Shuffle | 待执行的 WordCount 作业验证 |
| YARN | 从 JobTracker 到 ApplicationMaster | 待执行的应用日志与容器观察 |
| HBase / NoSQL | RowKey、列族、CAP、事务取舍 | 待执行的数据访问验证 |

> 此课程目前处于 growing 阶段。它建立概念地图与阅读顺序，而不是宣称所有主题已有完整实测数据。

## 资料来源与版本说明

- 《云计算与大数据》讲义：大数据概述、Hadoop、HDFS、HBase、NoSQL、MapReduce、Hadoop 架构演进、大数据应用。文件名为“第8章-大数据应用”的材料，原幻灯片封面标为“第14章”，因此此处按**主题**而非文件编号整理。
- [Apache Hadoop 2.7.1 — Documentation](https://hadoop.apache.org/docs/r2.7.1/)
- [Apache Hadoop 2.7.1 — HDFS Architecture](https://hadoop.apache.org/docs/r2.7.1/hadoop-project-dist/hadoop-hdfs/HdfsDesign.html)
- [Apache Hadoop 2.7.1 — MapReduce Tutorial](https://hadoop.apache.org/docs/r2.7.1/hadoop-mapreduce-client/hadoop-mapreduce-client-core/MapReduceTutorial.html)
- [Apache Hadoop 2.7.1 — YARN](https://hadoop.apache.org/docs/r2.7.1/hadoop-yarn/hadoop-yarn-site/YARN.html)
- [Apache HBase — Data Model](https://hbase.apache.org/docs/datamodel/)
