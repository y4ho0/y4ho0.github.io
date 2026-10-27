---
title: "从零理解 Hadoop 的系统边界：存储、计算与部署模式"
description: "从进程、RPC、HDFS、YARN、MapReduce 到伪分布式部署，建立可与实际 Hadoop 2.7.1 进程对照的架构地图。"
updatedAt: 2026-10-27
tags: ["Hadoop", "Architecture", "HDFS", "YARN"]
status: growing
draft: true
course: distributed-data-systems
---

“Hadoop 平台”不是一个孤立运行的程序。把全部组件画在同一张图上，容易误认为每次执行命令都依次经过所有组件。实际上，文件上传、批量作业和在线记录读取可以有完全不同的路径。

## 首先区分三个核心问题

| 问题 | 组件 | 关键对象 |
| --- | --- | --- |
| 文件怎样跨节点存放、读取和恢复 | HDFS | NameNode、DataNode、Block |
| 批量数据怎样分配任务计算 | MapReduce | InputSplit、Map、Shuffle、Reduce |
| 多个应用由谁分配计算资源 | YARN | ResourceManager、NodeManager、ApplicationMaster |

Hive、HBase、Spark、ZooKeeper 等项目可以与 Hadoop 生态协作，但不应该简单理解为随 HDFS 一起自动启动的全部子进程。

例如执行下面的文件系统命令，并不会因此执行 MapReduce：

~~~bash
hdfs dfs -ls /
~~~

## HDFS：控制路径与数据路径分离

:term[NameNode]{note="HDFS 元数据管理服务，维护命名空间、文件到数据块的关系及相关管理状态；文件内容通常由 DataNode 直接传输给客户端。"}主要负责名称与块管理；:term[DataNode]{note="负责实际保存与提供 HDFS 数据块的服务，通过心跳与块报告向 NameNode 汇报运行状态。"}则保存实际内容。

客户端读取一个文件时，简化请求顺序为：

~~~text
客户端 -- 查询文件块 --> NameNode
客户端 -- 读取数据块 --> DataNode
~~~

这解释了为什么 NameNode 不需要转发每一份文件的完整字节流，也揭示了其元数据集中管理的代价。

## MapReduce：描述计算，不是调度所有资源

WordCount 的 Map/Reduce 函数可用几行程序描述。但框架还需要完成 InputSplit、Map 输出分区、排序、Shuffle、Reducer 分组、失败任务重试以及结果写入等步骤。

MapReduce 是编程与执行框架，和专门负责资源仲裁的 YARN 不是同一个层次。

## YARN：应用运行和计算资源

Hadoop 2.x 中，ResourceManager 协调集群资源；NodeManager 管理节点上的容器与运行状态；ApplicationMaster 负责某一个应用的执行协调及资源请求。

~~~text
提交作业
  → ResourceManager 接收
  → 安排 ApplicationMaster
  → 申请更多容器
  → NodeManager 启动任务
  → 任务完成与资源释放
~~~

这是简化生命周期，不涵盖全部内部状态与失败处理。早期 Hadoop 1.x 的 JobTracker/TaskTracker 主要用于历史架构对比，不能直接把那张图当成当前 Hadoop 2.7.1 的全部运行流程。

## 三种运行模式的区别

**单机/本地模式**：可以依靠本地文件系统完成部分计算与开发验证，不必启动真实的 HDFS 服务。

**伪分布式模式**：在同一台机器上运行独立 NameNode、DataNode 等服务，具备进程通信和真实 HDFS 文件操作，但没有跨物理机器的故障隔离。

**完全分布式模式**：服务部署在多节点上，能够验证实际的副本放置、机架与网络故障及节点协调，但运维复杂度也随之增加。

这些名称描述部署结构，而非三种互不兼容的 Hadoop 软件版本。

## 与当前实验对应起来

已有 Ubuntu 16.04、OpenJDK 1.8.0_131、Hadoop 2.7.1 环境在启动 HDFS 后，通过 jps 观察到 NameNode、DataNode、SecondaryNameNode。

这个结果足以确认 HDFS 的对应 Java 进程存在，但不能据此声称已经启动 YARN。后续是否出现 ResourceManager、NodeManager，需要单独检查。

对于文件系统根目录，Linux 的 / 与 HDFS 的 / 属于不同命名空间。它们看起来都使用正斜杠，并不代表相同文件。

:::prototype{title="HDFS 数据写入的交互原型" href="/demos/hdfs-write/"}
通过四个步骤查看 NameNode 元数据申请、DataNode 目标选择、数据管道与完成确认。原型用概念化节点演示，没有连接真实集群。
:::

## 版本与术语边界

:term[SecondaryNameNode]{note="经典 HDFS 架构中协助执行检查点的服务，并非可以自动接管故障主节点的热备 NameNode。"}不能与 HDFS HA 的 Standby NameNode 混淆。

YARN、HDFS HA、Federation 属于分别解决资源管理、单 NameNode 可用性、命名空间扩展等不同问题的架构改进，不能合并成一种机制。

## 来源与验证

来源：《云计算与大数据》第 2 章 Hadoop 架构和伪分布式安装、第 7 章 Hadoop 架构演进。技术细节按 [Hadoop 2.7.1 官方文档](https://hadoop.apache.org/docs/r2.7.1/)核对。

已完成：HDFS 服务进程和基础文件操作。待执行：YARN 作业日志、多节点副本恢复、调度指标；本篇不构造未经执行的终端输出。
