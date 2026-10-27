---
title: "从 InputSplit 到 YARN：一个 MapReduce 作业怎样真正运行？"
description: "通过 WordCount 的中间键值对，跟踪输入切分、Map、Partition、Shuffle、Sort、Reduce、资源调度和失败重试。"
updatedAt: 2026-10-27
tags: ["MapReduce", "YARN", "Shuffle", "Scheduling"]
status: growing
draft: true
course: distributed-data-systems
---

使用 MapReduce 编写 WordCount，只需要定义如何将输入转换成键值对，以及如何聚合相同 key 的值。但是，一个作业能够运行在多台机器上，并非只靠这两段函数。框架还承担了输入组织、分区、数据传输、资源申请、执行监控与失败恢复。

## 输入切分不等于 HDFS Block

文件位于 HDFS 时，InputFormat 根据数据格式构造:term[InputSplit]{note="MapReduce 的逻辑输入分片，由 InputFormat 描述一部分输入数据范围；它不一定与 HDFS 物理数据块一一对应。"}。

InputSplit 通常对应一个 Map Task 处理的输入范围。RecordReader 再根据输入格式提供用户 Mapper 能理解的记录。处理结构化文件、压缩文件和普通文本时，这个切分关系并不完全相同。

## Map 阶段究竟输出什么？

以两行文本为例：

~~~text
Hello Hadoop Hello
Hadoop World
~~~

Mapper 将词映射成键值对：

~~~text
(Hello,1) (Hadoop,1) (Hello,1)
(Hadoop,1) (World,1)
~~~

框架随后必须让相同 key 的记录到达正确的 Reduce 分区，而不是让每个 Reducer 扫描全部 Map 的所有输出。

## Shuffle 不只是一次复制

Map 端先对中间输出进行分区，并在排序与溢写中组织数据。Reduce 端从 Map 输出位置抓取属于自己的分区，完成归并和分组。

~~~text
Map 输出
   ↓
Partition（分区）
   ↓
Sort / Spill / Merge
   ↓
Shuffle（跨任务获取）
   ↓
Reduce-side Merge / Grouping
   ↓
Reducer
   ↓
结果输出
~~~

:term[Shuffle]{note="MapReduce 将 Map 端的中间记录按分区、排序、复制与归并规则组织并传递给 Reduce 端的过程，不只是一次网络请求。"}的成本包括数据序列化、本地磁盘、网络传输和内存缓冲。多个 Reducer 并不自动意味着最终输出有一份全局有序的大文件。

## Combiner 不是强制执行的 Reducer

WordCount 可选地在 Map 端局部合并：

~~~text
(Hello,1) + (Hello,1) → (Hello,2)
~~~

这样可以减少 Shuffle 数据量。Combiner 的运行次数和位置由框架决定，不保证恰好执行一次。

使用时必须保证局部合并不改变最终结果。例如直接计算局部平均值并再次平均，通常不能得到全局平均；需要保留和与计数等可以安全组合的信息。

## 作业如何从提交变成进程？

在 Hadoop 2.x 的 YARN 模式下，ResourceManager 负责全局应用与资源管理，NodeManager 管理节点容器，ApplicationMaster 负责单个应用的资源申请和任务管理。

~~~text
Client 提交作业
    → ResourceManager
    → 安排 ApplicationMaster
    → AM 申请更多资源
    → NodeManager 启动任务容器
    → 任务执行、状态报告
    → 完成并释放资源
~~~

旧版架构里的 JobTracker、TaskTracker 解释的是 Hadoop 1.x 时代的设计，不能直接当作运行 Hadoop 2.7.1 的 YARN 架构图。

HDFS 负责存储 MapReduce 需要读取或写出的文件，YARN 则管理运行资源；两者不同层次，不应混写为一种服务。

## 重试意味着什么？

MapReduce 能在一定条件下重试失败任务，特别适合可以重复计算的函数。它不代表任何对外部数据库的写操作天然只执行一次。如果 Reducer 调用外部扣款接口，任务重试可能造成重复副作用，仍需业务层的幂等或事务设计。

## 与实验衔接

现有实验记录能够确认 HDFS 文件操作，但尚没有可靠保存的 WordCount 作业日志或 YARN application ID，因此本文保持机制分析草稿。

后续实验需要保存输入文本、运行模式、作业日志、Map/Reduce Task 数量、Reducer 分区结果及输出校验，区分本地运行与 YARN 集群运行。没有日志之前，不编造执行时间和 Shuffle 字节数。

## 来源

《云计算与大数据》第 6 章 MapReduce 与 Shuffle、第 7 章 Hadoop 架构演进及 YARN。补充校对：[Apache Hadoop 2.7.1 MapReduce Tutorial](https://hadoop.apache.org/docs/r2.7.1/hadoop-mapreduce-client/hadoop-mapreduce-client-core/MapReduceTutorial.html)、[Apache Hadoop YARN](https://hadoop.apache.org/docs/r2.7.1/hadoop-yarn/hadoop-yarn-site/YARN.html)。
