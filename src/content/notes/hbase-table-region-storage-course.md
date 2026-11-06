---
title: "从 HDFS 到 HBase：行键、Region 与读写存储路径"
description: "从为什么需要 HBase 出发，连接稀疏数据模型、RowKey 排序、Region 分布、WAL/MemStore/HFile 与 HBase Shell 实验。"
updatedAt: 2026-10-27
tags: ["HBase", "HDFS", "Region", "RowKey", "Storage Engine"]
status: growing
draft: true
course: distributed-data-systems
---

HDFS 适合存储大规模文件，并为批量扫描提供高吞吐能力。然而若需要根据主键频繁查询或更新一条业务记录，每次读取完整文件显然不是理想选择。HBase 在 Hadoop 存储生态中承担的就是另一类数据访问需求：面向有序行键的分布式稀疏表。

## HBase 不等于“有更多列的 MySQL”

HBase 的一个逻辑单元格可以按四个维度描述：

~~~text
(RowKey, ColumnFamily, Qualifier, Timestamp) -> Value
~~~

- RowKey（行键）：标识一行，并影响字节序排序和范围查询。
- Column Family（列族）：需要预先创建的重要存储组织单位。
- Column Qualifier（列限定符）：列族下的具体列名，可以因行变化。
- Timestamp：标识单元格数据的版本。最终可读取版本受配置、删除标记和压缩影响。
- Value：以字节为底层表示，应用需要约定编码和解释规则。

:term[稀疏表]{note="同一列族中，不同行可以拥有不同列限定符；没有写入的单元格通常不需要存储一个明确的空值。"}是 HBase 数据模型的重要特点，不能简单理解为关系数据库表中每条记录都按固定字段排列。

## 学生、课程与选课关系怎样建模？

实验三提供三组小型关系数据：Student 有 3 名学生、Course 有 3 门课程、SC 有 6 条选课记录。

一种直观的 HBase 教学模型：

| 表 | RowKey | Column Family 与示例列 |
| --- | --- | --- |
| Student | 学号，如 2015001 | info:name、info:sex、info:age |
| Course | 课程号，如 123001 | detail:name、detail:credit |
| SC | 学号#课程号，如 2015001#123001 | grade:score |

这种设计更贴近“用 RowKey 定位一行”的思想。采用学号#课程号作为选课关系行键，可以将同一学生的选课集中在相邻键范围；若经常按课程号查所有选课记录，则可能需要另一个索引表或者重新组织 RowKey。

题目参考答案采用 s001、c001、sc001 作为行键，还将不少字段分别定义为列族。这一方式可以演示 Shell 操作，但**教学示例的可运行性不等于生产系统建模的最优性**。实际选型需要先明确查询模式与写入热点。

当前实验仍应以题目约束和已有数据为验收标准；扩展设计用于理解差异，不代替原任务。

## 为什么 RowKey 的顺序这么重要？

HBase 的行按键排序。完整 RowKey 查询和有边界的范围 Scan 是天然的数据访问方式，而不是对任意列都自动建立 B+Tree 索引。

如果 RowKey 来自严格递增的时间戳，新的写入可能集中在少数键范围，从而让单个 Region 成为热点。可以通过键设计与 Region 划分优化负载，但不能简单增加随机前缀而忽略后续的范围查询。

:term[Region]{note="HBase 表的连续 RowKey 范围，是分配给 RegionServer 管理与服务的主要单位。随着数据增长可以发生分裂。"}将表的行键空间划分为若干范围，便于不同 RegionServer 提供服务。

## HBase 写入如何落盘？

经典 HBase 存储机制通常包含 WAL、MemStore 和 HFile 等角色：

~~~text
客户端 Put
     |
     v
 RegionServer
     |------> WAL（持久化恢复日志）
     |
     +------> MemStore（内存组织数据）
                    |
                  Flush
                    |
                    v
             HFile（存储文件）
                    |
                 Compaction
~~~

:term[WAL]{note="Write-Ahead Log，预写日志。为崩溃恢复提供写操作记录；具体确认、刷新和重放行为依赖版本与配置。"}用于帮助处理崩溃恢复，MemStore 接收和组织当前数据，Flush 生成 HFile。Compaction 则在后续整理磁盘文件与版本、删除标记等数据。

这张图刻意简化了读写缓存、锁、RPC、HDFS 客户端和后台线程；也不意味着每条 Put 都要等待一次 Compaction。

## HBase 的数据定位与版本差异

讲义中曾用 -ROOT-、.META. 描述历史数据定位结构。对于当前使用的 **HBase 1.1.5**，不能再照此绘制：-ROOT- 已在更早的 HBase 版本中被移除，当前应重点理解 hbase:meta、ZooKeeper 及客户端缓存等机制。

因此博客保留讲义中“为什么需要记录 Region 位置”的问题，但必须明确历史版本，避免把旧示意图当作 1.1.5 的运行架构。

## 如何用 Shell 验证表结构？

在确认 HBase 服务正常、并确认目标表没有需要保留的数据后，可先操作独立的实验用表，而不是贸然修改现成的 student 表：

~~~ruby
create 'garden_hbase_demo', 'info'
put 'garden_hbase_demo', '2015001', 'info:name', 'Zhangsan'
put 'garden_hbase_demo', '2015001', 'info:age', '23'
get 'garden_hbase_demo', '2015001'
scan 'garden_hbase_demo'
count 'garden_hbase_demo'
~~~

这些命令可显示 RowKey、列族和限定符的关系。**上面是计划的可复现示例，尚未提供实测终端输出**，不能直接视为第三次实验已经完成。

该表与实验三要求的 Student、Course、SC 以及可选 Java API Score 不同。实际实验记录会按题目另行整理，避免把演示数据和验收数据混在一起。

## 何时不适合 HBase？

如果要求跨多个业务实体的复杂联接、严格事务约束、多字段组合检索或成熟 SQL 功能，关系数据库可能更直接。HBase 主要围绕行键和列族提供访问能力，能否满足需求取决于数据规模、查询模式、一致性语义与运维代价。

## 来源与延伸

讲义基础：《云计算与大数据》第 4 章 HBase 数据模型、体系结构和 Region 管理；实验三《熟悉常用的 HBase 操作》提供 Student、Course、SC 示例与 Shell/Java API 任务。

版本核对：[Apache HBase Reference Guide](https://hbase.apache.org/book.html)、[Apache HBase Data Model](https://hbase.apache.org/docs/datamodel/)。

下一阶段：在 HBase 1.1.5 上运行独立的 Shell 数据操作并保留截图，核对真实的 Region 状态。未做分布式性能或故障注入测试。
