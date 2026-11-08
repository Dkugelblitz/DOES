// Verbatim copy of PLAN, CARDS, DES, HR and the design answer framework
// from "2-Day Pareto Interview Sprint.html" (sprint-2day).
export const PLAN=[
{d:"Day 1 · Data platform core",b:[
["Delta Lake essentials",90,["Transaction log: JSON commits, checkpoints, snapshots, OCC conflicts","OPTIMIZE, small files, liquid clustering vs Z-ORDER/partitioning","VACUUM vs time travel, RESTORE","MERGE: upsert, SCD2, performance tuning","Change Data Feed + deletion vectors"]],
["Unity Catalog & governance",60,["Metastore → catalog → schema → table; grants inheritance","Storage credentials, external locations, managed vs external","Row filters, column masks, lineage, audit"]],
["Ingestion & streaming",60,["Auto Loader: notification vs listing, schema evolution, rescue column","Structured Streaming: triggers, watermarks, checkpoints","Exactly-once = replayable source + checkpoint + idempotent sink","Lakeflow Declarative Pipelines: expectations, APPLY CHANGES"]],
["PySpark performance",90,["Narrow vs wide, shuffle, stages","Join strategies, broadcast, skew, AQE","Partitioning: repartition vs coalesce, file sizing","Read Spark UI: spill, long-tail tasks, tiny tasks","Window functions, pandas UDFs vs built-ins"]],
["SQL coding drills",90,["Dedup with ROW_NUMBER","Top-N per group","Gaps & islands","Running totals, moving average","Sessionization with LAG","Solve 8 timed problems (15 min each)"]],
["Design drills 1–2 (talk out loud)",60,["Medallion lakehouse, batch + streaming","OLTP CDC → Delta with SCD2, late data, backfill"]]]},
{d:"Day 2 · Breadth, coding and communication",b:[
["HackerRank AI-assisted format",60,["Do one practice task in an AI-enabled IDE or repo","Drill: debug-and-fix a bug using tests","Drill: implement a small feature (e.g. discount rules) against test cases","Practise narrating every AI prompt and what you verified"]],
["Python coding",60,["Hash map, two pointers, sliding window templates","Generators, decorators, GIL and concurrency answers","Solve 3 timed problems with edge cases and complexity"]],
["AWS data stack",75,["S3 layout, formats, lifecycle, encryption","Glue vs EMR vs Athena vs Redshift vs Databricks","Kinesis vs MSK","IAM least privilege, VPC endpoints, PrivateLink","DR: RTO/RPO, multi-AZ, multi-region"]],
["Gen AI",75,["RAG pipeline end to end and failure modes","Evals: golden set, recall@k, faithfulness, LLM-as-judge","Agents: tools, guardrails, observability","Prompt vs RAG vs fine-tune; cost and latency levers"]],
["Design drills 3–5",90,["Real-time fraud/analytics pipeline","Enterprise RAG copilot platform","Governed multi-tenant data platform with cost controls"]],
["Behavioral + resume deep dive",45,["4 STAR stories: scale, failure, conflict, trade-off","Prepare 2-minute walk through each resume project","3 questions to ask the interviewer"]],
["Rapid-fire review",30,["Flip every card, re-queue the ones you miss"]]]}];
export const CARDS=[
["Databricks","Delta transaction log?","_delta_log holds ordered JSON commits plus Parquet checkpoints. A snapshot is checkpoint + later commits. Writers use optimistic concurrency: validate no conflicting commit, else retry/fail."],
["Databricks","Fix the small-file problem?","OPTIMIZE (bin-packing), optimized writes + auto compaction, then liquid clustering or Z-ORDER for data skipping."],
["Databricks","Liquid clustering vs partitioning + Z-ORDER?","Liquid clustering is incremental, keys can change without rewriting, and it handles skew and high cardinality. Use it for new tables; partition only huge, low-cardinality data."],
["Databricks","VACUUM and time travel?","VACUUM deletes unreferenced files older than retention (default 7 days), which shrinks the time-travel window. Never go below the longest reader or stream lag."],
["Databricks","Speed up MERGE?","Prune with a partition/cluster predicate in ON, dedupe the source, enable deletion vectors, avoid broad updates."],
["Databricks","SCD2 with MERGE?","Stage changes, close the current row (end_date, is_current=false), insert the new version. Or use APPLY CHANGES ... STORED AS SCD TYPE 2."],
["Databricks","Unity Catalog model?","Metastore → catalog → schema → table/volume/function. Storage credential + external location for external data. Grants inherit downward. Built-in lineage and audit."],
["Databricks","Row/column security?","Row filters and column masks (SQL functions bound to tables) are preferred over dynamic views."],
["Databricks","Auto Loader?","cloudFiles incremental ingest. File notification mode scales better than directory listing. Uses schemaLocation, rescued data column, and checkpoint for file tracking."],
["Databricks","Exactly-once in streaming?","Replayable source + checkpointed offsets + idempotent or transactional sink. In foreachBatch use MERGE or txnAppId/txnVersion."],
["Databricks","Declarative Pipelines?","Declare streaming tables and materialized views; dependencies and orchestration are automatic. Expectations warn, drop or fail on bad rows."],
["Databricks","Jobs compute choices?","Job clusters are cheaper and isolated; serverless removes startup; repair runs rerun failed tasks only; cluster policies cap cost."],
["PySpark","Handle data skew?","AQE skew join, broadcast the small side, salting hot keys, repartition on a better key."],
["PySpark","Join strategies?","Broadcast hash (small side), sort-merge (default for large), shuffle hash. Check with explain()."],
["PySpark","repartition vs coalesce?","repartition = full shuffle, any count. coalesce = narrow, reduce only, can create uneven partitions."],
["PySpark","Why avoid Python UDFs?","Row-by-row serialization to Python. Prefer built-ins, then pandas UDFs (Arrow batches)."],
["PySpark","Read the Spark UI?","Long-tail tasks = skew. Spill = memory pressure. Thousands of tiny tasks = small files. Big shuffle read/write = wide transform to rethink."],
["PySpark","Watermark?","Bounds streaming state; events later than the watermark are dropped from stateful ops."],
["AWS","Data lake layout on S3?","Partition by query pattern, columnar formats (Parquet/Iceberg/Delta), lifecycle tiers, SSE-KMS, strong read-after-write consistency."],
["AWS","Glue vs EMR vs Databricks?","Glue: serverless simple ETL. EMR: control and cost at scale. Databricks: Delta, governance, collaboration, ML."],
["AWS","Kinesis vs MSK?","Kinesis: managed shards, simple. MSK: Kafka ecosystem, throughput and retention control, more ops."],
["AWS","IAM and network basics?","Least-privilege roles, no long-lived keys, SCPs, S3 gateway endpoints, PrivateLink, private subnets."],
["AWS","Disaster recovery tiers?","Backup/restore → pilot light → warm standby → active-active; pick by RTO/RPO and cost."],
["Gen AI","RAG pipeline?","Ingest → chunk → embed → index (hybrid with BM25) → retrieve → rerank → prompt with citations → LLM → evaluate."],
["Gen AI","RAG failure modes?","Poor chunking, no reranker, stale index, retrieval misses, ungrounded answers. Fix: hybrid search, metadata filters, evals, citations."],
["Gen AI","Evaluate an LLM app?","Golden set, retrieval recall@k, faithfulness, LLM-as-judge with rubric, online feedback, regression gates in CI."],
["Gen AI","Prompt vs RAG vs fine-tune?","Prompt first; RAG for fresh/private knowledge; fine-tune for style, format, latency or small-model quality."],
["Gen AI","Agent design?","LLM + tools + loop + memory. Add timeouts, idempotent tools, guardrails, human approval for risky actions, tracing."],
["Gen AI","Cut cost and latency?","Caching, model routing, streaming, prompt trimming, batching, quantized or smaller models."],
["Python","GIL implications?","Threads help I/O-bound work; use multiprocessing for CPU-bound; asyncio for many concurrent sockets."],
["Python","Complexities to know?","dict/set average O(1); list append amortized O(1); insert at front O(n); sort O(n log n); heapq push/pop O(log n)."],
["Python","Generators?","Lazy, O(1) memory, ideal for streaming large files and pipelines."],
["SQL","Deduplicate rows?","ROW_NUMBER() OVER (PARTITION BY key ORDER BY ts DESC) = 1 in a CTE."],
["SQL","Gaps and islands?","Group key = value − ROW_NUMBER() (or date − row_number) to find consecutive runs."],
["SQL","Sessionization?","LAG the timestamp, flag gaps over 30 minutes, cumulative SUM of flags = session id."],
["SQL","NOT IN pitfall?","A NULL in the subquery makes NOT IN return nothing; use NOT EXISTS."],
["SQL","Running total?","SUM(x) OVER (PARTITION BY g ORDER BY t ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)."]];
export const DES=[
["Medallion lakehouse (batch + stream)",["Clarify: volume, freshness SLA, consumers, data contracts","Bronze raw append (Auto Loader) → Silver cleaned/deduped (MERGE, expectations) → Gold marts","Unity Catalog per layer/domain, lineage, row/column security","Reliability: checkpoints, idempotent writes, replay from bronze, quarantine table","Cost: job clusters/serverless, OPTIMIZE schedule, liquid clustering"]],
["CDC from OLTP to Delta with SCD2",["Log-based CDC (Debezium/DMS) → Kafka/S3 → bronze with op + ordering key","Silver: MERGE or APPLY CHANGES, sequence by commit LSN/timestamp","Late/out-of-order: sequence column, watermark, backfill via replay","Deletes: soft delete or deletion vectors; schema drift: rescue column","Validate: row counts, checksums, reconciliation job"]],
["Real-time fraud / analytics pipeline",["Events → Kafka/Kinesis → Structured Streaming (stateful, watermark)","Features: windowed aggregates; low-latency store (online feature store/DynamoDB)","Scoring: model serving endpoint with p99 budget; fallback rules","Exactly-once sink, dead-letter queue, backpressure, autoscaling","Observability: lag, latency, drift; offline reprocessing for audits"]],
["Enterprise RAG copilot platform",["Ingest connectors → parse → chunk → embed → vector index (+ keyword) with ACL metadata","Query: auth, rewrite, hybrid retrieve, rerank, grounded prompt with citations","Security: per-user ACL filtering at retrieval, PII redaction, prompt-injection defenses","Evals and feedback loop, caching, model routing, cost per query","Freshness: incremental re-index on source change"]],
["Governed multi-tenant data platform",["Isolation model: workspace/catalog per domain or tenant; shared metastore","Central governance in Unity Catalog, tags, data classification, audit logs","Network: private link, VPC endpoints, customer-managed keys","Compute governance: cluster policies, budgets, tagging for chargeback","CI/CD with IaC, environments, data quality and SLA monitoring"]],
["AI interviewer pipeline (reported HackerRank question)",["Generate role-appropriate questions from resume + job description","Real-time speech → transcription → LLM follow-ups with low latency","Score free-form answers against a rubric; calibrate, audit for bias","Storage, privacy, consent; human review of borderline cases"]]];
export const HR=[
["What is new","An AI assistant is enabled in the interview IDE or code repo. Interviewers can watch your AI interactions in real time, and reports can include an AI-fluency grade. You may be able to choose when to share the problem statement with the assistant. Data roles can use notebooks/VS Code with AI chat. Some rounds are AI-run, conversational resume deep dives."],
["Task shapes reported","Debug-and-fix tasks, implementing a feature against visible test cases (e.g. discount coupons), classic stdin/stdout coding, system design, and resume deep dive."],
["How to behave","Spend the first minutes reading the repo and tests. State your plan before prompting. Ask the AI for ideas or snippets, not the whole solution. Read and run everything it writes. Say what you accepted, changed or rejected and why. Cover edge cases and complexity out loud."],
["Format risk","Tests are customizable and one candidate reported a round not matching the format they were told. Ask the recruiter for the exact round formats, tools allowed and duration."]];
export const HR_DISCLAIMER="Based on public HackerRank release notes and candidate reports; confirm your company's exact format with the recruiter.";
export const FRAMEWORK=[["Requirements, scale, SLAs",5],["High-level data flow",10],["Deep dive on 2 components",15],["Failure modes, reliability, backfill",5],["Governance, security, cost, trade-offs",5]];
export const SPRINT_INTRO="The ~20% of topics that cover ~80% of architect-level data/AI interviews, plus the new AI-assisted HackerRank format.";
