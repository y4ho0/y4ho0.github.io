---
title: "为什么 MapReduce 不再自己管理整个集群？理解 YARN 的职责拆分"
description: "区分 Hadoop 1.x 的 JobTracker/TaskTracker 与 Hadoop 2.x 的 ResourceManager、NodeManager、ApplicationMaster，并明确 HA 和 Federation 的不同目标。"
updatedAt: 2026-10-23
tags: ["YARN", "Hadoop", "Scheduling", "High Availability"]
status: growing
draft: true
course: distributed-data-systems
---

打开早期 MapReduce 架构图，会看到 JobTracker 和 TaskTracker。再阅读 Hadoop 2.x 的文档，出现的却是 ResourceManager、NodeManager、ApplicationMaster。这不是简单改名，而是将“集群资源管理”从单一计算框架中独立出来。

## 旧架构的局限

Hadoop 1.x 经典 MapReduce 中，JobTracker 负责作业管理、任务调度等多种职责，TaskTracker 在各计算节点上报告状态并执行任务。这种模型能工作，但也让集群的资源管理强烈绑定 MapReduce。

如果希望在同一集群运行不同类型的计算框架，资源分配就不应只服务于 Map 和 Reduce 两类任务。

## YARN 把职责分给了哪些组件？

| 角色 | 核心任务 |
| --- | --- |
| ResourceManager | 全局应用管理与资源仲裁 |
| NodeManager | 节点资源报告、容器管理 |
| ApplicationMaster | 单个应用的资源申请、任务协同及监控 |
| Container | 提供分配给任务的运行资源 |

这些角色解决的是不同范围的问题。

ResourceManager 不需要亲自管理每一个 Map task 的具体算法；ApplicationMaster 管理的是某一个应用的生命周期。NodeManager 负责实际节点上的容器，而不应该被当作独立的 MapReduce Scheduler。

## 从提交到执行：一个简化过程

~~~text
客户端提交应用
       |
       v
ResourceManager 接受申请
       |
       v
安排 ApplicationMaster 容器
       |
       v
ApplicationMaster 向 RM 申请更多资源
       |
       v
NodeManager 启动任务容器
       |
       v
任务运行、报告进度与结束
~~~

这不是对所有状态与网络细节的穷尽，但清楚表达了“全局资源管理”和“每应用任务管理”的分层。

一个重要边界是：**YARN 不等于 MapReduce。** MapReduce 可以运行在 YARN 上，但同一资源管理架构的设计目标是支持多种应用类型。

## 别把 YARN、HDFS HA、Federation 混成一个升级包

Hadoop 2.x 架构演进包含彼此独立的目标：

- **YARN**：解耦计算资源管理与具体计算模型；
- **HDFS High Availability（HA）**：通过 Active/Standby NameNode 等机制缓解单一 NameNode 故障造成的不可用；
- **HDFS Federation**：允许多个命名空间/NameNode 管理各自的块池，缓解单一命名空间的扩展约束。

SecondaryNameNode 是经典的检查点辅助节点，不等于 HA 中的 Standby NameNode。

因此，YARN 是否运行，与 HDFS 当前是否启用 HA，属于两个不同的配置问题。

## 已有实验的边界

在现有的 Ubuntu 16.04 / Hadoop 2.7.1 伪分布式环境中，之前主要启动并操作 HDFS。没有留存 ResourceManager 与 NodeManager 的成功运行记录，也没有保存 application ID 的作业日志。

后续可先用只读命令确认服务是否可达：

~~~bash
cd /usr/local/hadoop
./bin/yarn node -list
./bin/yarn application -list
~~~

若提示连接失败，应先判断是否未启动 YARN、配置不正确或服务不可达；不能把错误等同于 YARN 本身的实现缺陷。

进一步的完整验证需要独立部署并保留运行环境及日志，不能直接从一张旧版 JobTracker 示意图推断当前进程拓扑。

## 参考资料

- 《云计算与大数据》：第 7 章 Hadoop 的优化与发展、HDFS 2.0、YARN 工作流程。
- [Apache Hadoop 2.7.1 — YARN Architecture](https://hadoop.apache.org/docs/r2.7.1/hadoop-yarn/hadoop-yarn-site/YARN.html)
- [Apache Hadoop 2.7.1 — HDFS HA](https://hadoop.apache.org/docs/r2.7.1/hadoop-project-dist/hadoop-hdfs/HDFSHighAvailabilityWithQJM.html)
- [Apache Hadoop 2.7.1 — Federation](https://hadoop.apache.org/docs/r2.7.1/hadoop-project-dist/hadoop-hdfs/Federation.html)

> **草稿待补**：实际 YARN 进程和应用日志、至少一张自行绘制的 MRv1 / YARN 结构对照图。
