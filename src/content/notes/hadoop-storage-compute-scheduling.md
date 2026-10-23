---
title: "Hadoop 的三个问题：数据放哪、任务怎么跑、资源由谁分配？"
description: "以文件上传和 WordCount 为线索解释 HDFS、MapReduce 与 YARN 的边界，区分经典架构和 Hadoop 2.x。"
updatedAt: 2026-10-23
tags: ["Hadoop", "HDFS", "MapReduce", "YARN", "Architecture"]
status: growing
draft: true
course: distributed-data-systems
---

Hadoop 经常被当作一个整体，但其中至少有三个可以独立回答的问题：

- 文件存放在哪里、损坏后如何处理？——**HDFS**
- 如何把一次批量计算描述成可分配的任务？——**MapReduce**
- 多个任务同时到来时，谁来分配 CPU 和内存？——**YARN**

理解这三层的职责，比背诵生态组件名单更重要。

## 同一份数据走过三种不同路径

上传一个文本文件时，客户端调用 HDFS 文件接口，由 NameNode 管理逻辑路径，具体数据块写入 DataNode。这里**不需要启动 MapReduce 作业**。

提交 WordCount 批处理任务时，MapReduce 负责输入分片、Map/Reduce 逻辑和中间数据处理。在使用 YARN 的部署中，应用还需要从 YARN 获取计算资源。

如果改为 HBase 随机读取某一行数据，则它有自己的数据访问机制，不需要先执行一个 MapReduce 任务。HBase 可使用 HDFS 作为底层存储，但两者不是同一个 API。

可以把它理解为不同的职责边界，而不是一个请求严格穿过所有组件的流水线。

## HDFS：从路径到数据块

客户端只需要指定逻辑路径，例如：

~~~bash
hdfs dfs -cat /user/hadoop/experiment2/text.txt
~~~

NameNode 负责文件系统命名空间和块元数据；文件内容通常通过客户端与 DataNode 之间的连接读写。块副本提供存储冗余，但单机伪分布式不等于真实的跨机器容灾。

对于元数据持久化，NameNode 借助 FsImage 和 EditLog 恢复。SecondaryNameNode 主要辅助检查点处理，不能直接当作备用 NameNode。

## MapReduce：从文件到键值对

MapReduce 将批量计算分解为 Map 和 Reduce 任务。编写 WordCount 时，Mapper 读取输入记录并发出〈word, 1〉；框架将同一 key 的值组织到 Reducer，后者累加得到计数。

框架还有大量隐藏在两个函数背后的工作：输入切分、分区、排序、Shuffle、任务重试和输出提交。两段用户函数只是编程抽象的核心，不是全部运行机制。

## YARN：资源管理与应用执行

Hadoop 2.x 中，YARN 是一套资源管理与应用协调架构。

| 组件 | 主要职责 |
| --- | --- |
| ResourceManager | 管理整个集群的资源分配 |
| NodeManager | 管理单节点上的计算容器及资源报告 |
| ApplicationMaster | 协调某一个应用的资源申请、任务执行及监控 |
| Container | 提供任务运行所需的资源环境 |

YARN 不决定 Map 阶段要输出哪些键值对。那是 MapReduce 程序和运行框架负责的事。

## 为什么讲义里还有 JobTracker、TaskTracker？

经典 Hadoop 1.x MapReduce 架构中，JobTracker、TaskTracker 同时承担了计算框架与资源调度方面的职责。这些术语对于理解历史架构非常重要，但**不能直接画成 Hadoop 2.7.1 在 YARN 模式下的实际任务执行架构**。

从旧架构向新架构的关键变化，是把资源管理与每个应用的任务生命周期管理分离，让同一集群能够服务不止一种计算模型。它并不意味着 Hadoop 2.x 所有集群都必须在任意时刻运行所有生态组件。

## 当前实验能够证明什么？

既有环境是 Ubuntu 16.04 + Hadoop 2.7.1。已通过 jps 观察到 NameNode、DataNode、SecondaryNameNode，并完成 HDFS 文件操作。

但 **jps 没有出现 ResourceManager、NodeManager，并不能仅据此判断 YARN 工作与否**：当时运行的命令是启动 HDFS 服务，YARN 是否另行启动尚需专门核对。因此不能把“运行过 HDFS”写成“完成了 MapReduce/YARN 集群验证”。

下一步计划执行并记录：

~~~bash
cd /usr/local/hadoop
./bin/hdfs dfsadmin -report
./bin/yarn node -list
~~~

后一条只有在 YARN 服务启动且配置正确时才有意义。暂不把它的期望结果当作已经验证的事实。

## 参考资料

- 《云计算与大数据》：第 2 章 Hadoop 项目结构；第 6 章 MapReduce；第 7 章 Hadoop 架构演进。
- [HDFS Architecture · Hadoop 2.7.1](https://hadoop.apache.org/docs/r2.7.1/hadoop-project-dist/hadoop-hdfs/HdfsDesign.html)
- [MapReduce Tutorial · Hadoop 2.7.1](https://hadoop.apache.org/docs/r2.7.1/hadoop-mapreduce-client/hadoop-mapreduce-client-core/MapReduceTutorial.html)
- [YARN Architecture · Hadoop 2.7.1](https://hadoop.apache.org/docs/r2.7.1/hadoop-yarn/hadoop-yarn-site/YARN.html)
