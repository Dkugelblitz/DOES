// Verbatim copy of level, flag, badge, title and message data from
// "Data Prep Academy.html" (prep-academy). UX/rules spec only.
export const R=["Data Engineer","Principal Data Engineer","Data Architect"];
export const RD=["Master the fundamentals interviewers always probe: Delta basics, joins, window SQL, Spark shuffles and clean pipelines.","Add depth and judgement: performance tuning, streaming correctness, governance, cost and mentoring-level trade-offs.","Lead with design: platforms, multi-tenancy, DR, AI/RAG architecture, trade-offs and clear communication."];
export const ICONS=["🧱","🛠️","🏛️"];
// domain|topic|min_level|pareto digits
export const T=`Delta Lake|ACID & transaction log|1|123
Delta Lake|OPTIMIZE & small files|1|123
Delta Lake|MERGE & SCD1/SCD2|1|123
Delta Lake|Schema enforcement & evolution|1|1
Delta Lake|Time travel & VACUUM|1|12
Delta Lake|Z-ORDER & liquid clustering|2|23
Delta Lake|Concurrency & OCC conflicts|2|23
Delta Lake|Change Data Feed|2|2
Delta Lake|Deletion vectors|2|
Delta Lake|Table layout strategy at scale|3|3
Unity Catalog|Catalog, schema, table model|1|12
Unity Catalog|Permissions & grants|1|123
Unity Catalog|Managed vs external data|1|1
Unity Catalog|Row & column security|2|23
Unity Catalog|Lineage & discovery|2|
Unity Catalog|Metastore & multi-workspace governance|3|3
Unity Catalog|Delta Sharing & data products|3|3
Ingestion|Auto Loader|1|123
Ingestion|Structured Streaming basics|1|12
Ingestion|Checkpointing & exactly-once|2|123
Ingestion|CDC pipelines|2|23
Ingestion|Schema drift & late data|2|2
Ingestion|Declarative pipelines & expectations|2|23
Ingestion|Streaming at scale & backpressure|3|3
Platform|Jobs & Workflows|1|1
Platform|Cluster policies & cost control|2|23
Platform|SQL warehouses & serverless|2|2
Platform|MLflow & model serving|3|
Platform|Vector Search & RAG integration|3|3
Platform|Compute governance & FinOps|3|3
PySpark|Architecture & lazy evaluation|1|123
PySpark|Joins & broadcast|1|123
PySpark|Shuffle & partitioning|1|123
PySpark|Window functions|1|12
PySpark|UDFs & pandas UDFs|1|
PySpark|AQE & skew handling|2|123
PySpark|Caching & memory tuning|2|2
PySpark|Spark UI debugging|2|23
PySpark|Testing PySpark code|2|
Python|Data structures & complexity|1|12
Python|Coding patterns (hashmap, two pointers)|1|123
Python|Generators & decorators|1|1
Python|Pandas|1|
Python|Concurrency & the GIL|2|2
Python|Typing, OOP & design patterns|2|
Python|Packaging & CI|2|
SQL|Joins & aggregations|1|1
SQL|Window functions|1|123
SQL|Dedup & top-N per group|1|123
SQL|CTEs & recursion|1|
SQL|Gaps, islands & sessionization|2|23
SQL|Query plans & optimization|2|23
SQL|Dimensional modeling|2|23
SQL|Data quality checks|2|
AWS|S3 lake design|1|123
AWS|Glue, Athena, EMR, Redshift|1|12
AWS|IAM & networking|2|123
AWS|Kinesis & MSK|2|23
AWS|IaC (Terraform/CloudFormation)|2|2
AWS|DR & multi-region|3|3
AWS|Cost optimization|3|3
Gen AI|LLM & prompt fundamentals|1|1
Gen AI|RAG architecture|2|23
Gen AI|Evals & guardrails|3|3
Gen AI|Agents & MCP|3|3
Gen AI|LLMOps, cost & latency|3|3
Architecture|Medallion lakehouse|1|123
Architecture|Batch vs streaming (lambda/kappa)|2|23
Architecture|Observability & data quality|2|2
Architecture|Data mesh & data products|3|3
Architecture|Multi-tenant governed platform|3|3
Architecture|Real-time analytics design|3|3
Architecture|Trade-offs & decision records|3|3
Interview|HackerRank AI-assisted format|1|123
Interview|Behavioral STAR & resume deep dive|1|123
Interview|System design answer framework|2|23`.split("\n").map(l=>{const[d,n,v,p]=l.split("|");return{d,n,v:+v,p}});
export const TITLES=["Rookie","Pipeline Builder","Lakehouse Engineer","Spark Tamer","Senior Craftsperson","Principal Mind","Architect Legend"];
export const BADGES=[["🌱","First topic"],["🔥","3-day streak"],["⚡","7-day streak"],["📚","10 topics"],["🏔️","25 topics"],["🏆","50 topics"],["⏱️","10 hours"],["⏳","50 hours"],["📝","5 notes"],["🔁","5 revisions"],["🎯","Pareto Pro"],["🌙","Night owl"],["🌅","Early bird"]];
export const CH=["Every topic you finish is one fewer surprise in the interview. Nice work!","You’re building real depth, not just memorising. Keep going!","Small, steady sessions beat last-minute cramming. You’re doing it right.","Progress isn’t always loud, but yours is adding up."];
export const BYE=["Great session. Rest well, your brain files this away while you sleep.","You showed up today, and that’s what separates prepared candidates from the rest.","Proud of the effort. Come back tomorrow and keep the streak alive!","Every hour here is an hour of confidence you’ll feel in the room. See you soon."];
