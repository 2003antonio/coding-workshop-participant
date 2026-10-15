"""A large demo organisation, added on top of the small one in demo_seed.

500 people (2 admins, 30 managers, 468 employees), 30 tech teams of 10-20
members, 7 projects per team (210), 4-6 deliverables per project, and
allocations. Everything follows the rules the API enforces, so no screen shows
a state the app could not have produced:
- a team's lead is a manager, never a member of a team they lead; one team per person;
- deliverable and allocation dates sit inside their project's dates;
- dependencies point to earlier deliverables of the same project (so no cycles),
  and nothing is in progress or done before its dependencies are done;
- a completed project has every deliverable done;
- allocations go to members of the project's team, at most one per person and
  project, and nobody passes 40 hours in any week.

Built from a fixed random seed, so every run creates the same organisation
(dates are relative to the current week). Ids are made here and rows go in with
multi-row INSERTs, so seeding the cloud database is a few dozen round trips.
Sign-in passwords are the demo's role passwords; one hash per role.
"""

import collections
import datetime
import random
import uuid
from typing import Optional

from common import audit, auth, db, demo_seed, weeks

SEED = 20261015
_BATCH = 200  # rows per INSERT; far below Postgres's 65535-parameter limit

# Job titles by kind of team; the last three kinds are the cross-functional people.
_TITLES = {
    "platform": ["Platform Engineer", "Infrastructure Engineer", "DevOps Engineer"],
    "sre": ["Site Reliability Engineer", "DevOps Engineer", "Observability Engineer"],
    "data": ["Data Engineer", "Analytics Engineer", "Data Analyst"],
    "ml": ["Machine Learning Engineer", "Data Scientist", "Applied Scientist"],
    "ios": ["iOS Engineer", "Mobile Engineer"],
    "android": ["Android Engineer", "Mobile Engineer"],
    "web": ["Frontend Engineer", "Full Stack Engineer", "UI Engineer"],
    "security": ["Security Engineer", "Application Security Engineer", "GRC Analyst"],
    "product": ["Software Engineer", "Backend Engineer", "Full Stack Engineer"],
    "tools": ["Software Engineer", "Build Engineer", "Developer Productivity Engineer"],
    "qa": ["QA Engineer", "Software Engineer in Test", "Test Automation Engineer"],
}
_CROSS_FUNCTIONAL = [("Product Manager", 0.07), ("Product Designer", 0.05), ("Technical Writer", 0.03)]
# (prefix, weight, hourly rate range); salary = hourly rate x 2080
_LEVELS = [("Junior ", 10, (38, 48)), ("", 35, (50, 65)), ("Senior ", 35, (66, 82)),
           ("Staff ", 15, (83, 100)), ("Principal ", 5, (101, 120))]

# Deliverable phases by kind of work, in order; each project takes 4-6 of them.
_PHASES = {
    "infra": ["RFC and design review", "Proof of concept", "Terraform modules", "Staging rollout",
              "Load and failover tests", "Production rollout", "Runbooks and handover"],
    "data": ["Source analysis", "Schema design", "Pipeline build", "Backfill",
             "Data quality checks", "Dashboards", "Handover to analysts"],
    "ml": ["Problem framing", "Dataset preparation", "Baseline model", "Model training",
           "Offline evaluation", "Shadow deployment", "Online A/B test", "Launch"],
    "app": ["UX research", "Designs in Figma", "API contract", "Build",
            "QA and accessibility pass", "Beta release", "Full release"],
    "security": ["Scoping", "Control design", "Implementation", "Internal audit",
                 "Remediation", "External audit", "Sign-off"],
    "product": ["Requirements", "API spec", "Implementation", "Integration tests",
                "Beta", "Launch", "Docs and runbooks"],
}
_PHASES_BY_KIND = {"platform": "infra", "sre": "infra", "data": "data", "ml": "ml", "ios": "app",
                   "android": "app", "web": "app", "security": "security", "product": "product",
                   "tools": "product", "qa": "product"}

# (team name, kind, its seven projects)
TEAMS = [
    ("Cloud Infrastructure", "platform", ["Kubernetes 1.31 upgrade", "Terraform module registry",
     "Multi-region failover", "EKS cost optimisation", "Golden AMI pipeline", "Service mesh rollout",
     "Spot instance autoscaling"]),
    ("Site Reliability", "sre", ["SLO dashboards for tier-1 services", "Incident response runbooks",
     "Chaos engineering game days", "On-call load rebalancing", "Synthetic monitoring",
     "Error budget policy", "Capacity planning model"]),
    ("Observability", "sre", ["OpenTelemetry tracing rollout", "Log pipeline to ClickHouse",
     "Metrics cardinality cleanup", "Alert noise reduction", "Unified service catalog",
     "Continuous profiling in production", "Grafana dashboards as code"]),
    ("Developer Experience", "tools", ["Monorepo build caching", "CI pipeline speedup",
     "Local dev containers", "Internal developer portal", "Preview environments per PR",
     "Flaky test quarantine", "Code owners automation"]),
    ("Databases", "platform", ["Postgres 17 migration", "Read replica routing", "Online schema migrations",
     "Backup restore drills", "Connection pooling with PgBouncer", "Redis cluster upgrade",
     "Database cost review"]),
    ("Networking and Edge", "platform", ["CDN migration", "Zero-trust network access", "IPv6 dual stack",
     "WAF rule tuning", "Global load balancer", "DNS failover automation", "TLS certificate automation"]),
    ("Identity and Access", "security", ["SSO with SAML and OIDC", "Passkey sign-in", "Role-based access v2",
     "SCIM user provisioning", "Session management rewrite", "MFA enforcement", "Audit log export"]),
    ("Security Engineering", "security", ["SOC 2 Type II evidence", "Secrets manager migration",
     "Dependency vulnerability scanning", "Container image signing", "Pen test remediation",
     "Threat modelling programme", "Bug bounty launch"]),
    ("Payments", "product", ["Payments API v3", "3-D Secure 2 rollout", "Refunds automation",
     "Multi-currency settlement", "Smart payment retries", "PCI scope reduction", "Ledger reconciliation"]),
    ("Billing", "product", ["Usage-based billing", "Invoice PDF redesign", "Tax calculation service",
     "Dunning emails", "Plan upgrade flow", "Revenue recognition export", "Billing event stream"]),
    ("Search", "product", ["Elasticsearch 8 upgrade", "Semantic search with embeddings",
     "Autocomplete service", "Search relevance tuning", "Typo tolerance", "Faceted filters",
     "Search analytics"]),
    ("Messaging", "product", ["Kafka cluster migration", "Event schema registry", "Notification service v2",
     "Email deliverability", "Push notification batching", "Webhook delivery retries",
     "Dead-letter queue tooling"]),
    ("API Platform", "product", ["GraphQL gateway", "Public API rate limiting", "API versioning policy",
     "OpenAPI SDK generation", "Partner API sandbox", "gRPC for internal services", "API usage analytics"]),
    ("Data Platform", "data", ["Lakehouse on Apache Iceberg", "Airflow to Dagster migration",
     "Change data capture pipeline", "Data catalog", "dbt model refactor", "Streaming ingestion",
     "Data retention policies"]),
    ("Analytics Engineering", "data", ["Executive KPI dashboard", "Product analytics events v2",
     "Experimentation metrics", "Revenue data mart", "Self-serve BI rollout", "Data quality monitors",
     "Marketing attribution model"]),
    ("Machine Learning", "ml", ["Fraud scoring model", "Recommendation engine v2", "Feature store",
     "Model monitoring", "Churn prediction", "GPU training pipeline", "A/B testing for models"]),
    ("AI Assistants", "ml", ["LLM support assistant", "Retrieval-augmented help center",
     "Prompt evaluation harness", "AI code review bot", "Document summarisation",
     "Guardrails and red teaming", "Voice assistant prototype"]),
    ("iOS", "ios", ["iOS offline mode", "SwiftUI migration", "App Store release automation", "iOS widgets",
     "iOS crash rate reduction", "iOS accessibility audit", "Apple Pay checkout"]),
    ("Android", "android", ["Jetpack Compose migration", "Android offline sync", "Play Store staged rollouts",
     "Android app size reduction", "Android crash rate reduction", "Material 3 redesign",
     "Google Pay checkout"]),
    ("Web Frontend", "web", ["React 19 upgrade", "Design system v3", "Core Web Vitals improvements",
     "Checkout redesign", "Server-side rendering", "WCAG 2.2 accessibility", "Dark mode"]),
    ("Growth", "web", ["Onboarding flow redesign", "Referral programme", "Pricing page experiments",
     "Lifecycle email journeys", "SEO landing pages", "Free trial conversion", "In-app announcements"]),
    ("Customer Integrations", "product", ["Salesforce connector", "Slack app v2", "Zapier integration",
     "Microsoft Teams app", "HubSpot sync", "Integration marketplace", "Jira integration"]),
    ("Internal Tools", "tools", ["Admin console rewrite", "Support agent tooling", "Feature flag service",
     "Impersonation audit trail", "Back-office reporting", "Access request workflow",
     "Internal status page"]),
    ("Quality Engineering", "qa", ["End-to-end test suite", "Contract testing", "Performance test harness",
     "Test data management", "Visual regression testing", "Mobile device farm", "Release quality gates"]),
    ("Release Engineering", "tools", ["Trunk-based development", "Canary deployments",
     "Release train automation", "One-click rollback", "Artifact registry migration",
     "Reproducible builds", "DORA metrics dashboard"]),
    ("Storage", "platform", ["S3 lifecycle policies", "Object storage encryption", "File upload service v2",
     "Media transcoding pipeline", "Cold storage backups", "Storage cost dashboard",
     "Chunked large file uploads"]),
    ("Compliance Engineering", "security", ["GDPR data subject requests", "EU data residency",
     "ISO 27001 controls", "Access review automation", "Data classification", "Vendor risk tooling",
     "Privacy impact assessments"]),
    ("Marketplace", "product", ["Seller onboarding", "Listing quality scoring", "Marketplace payouts",
     "Reviews and ratings", "Seller analytics", "Catalog import API", "Dispute resolution flow"]),
    ("Platform Services", "product", ["Feature entitlements service", "Multi-tenant isolation",
     "Rate limiter service", "Background job framework", "Dynamic config service",
     "Distributed cache layer", "Tenant data export"]),
    ("Desktop", "web", ["Electron 33 upgrade", "Desktop offline mode", "Auto-update service",
     "Desktop notifications", "Keyboard shortcuts", "Desktop crash reporting", "Native file sync"]),
]

_FIRST = ["Aarav", "Abigail", "Adebayo", "Aiko", "Alejandro", "Amara", "Amir", "Ana", "Andrei", "Anika",
          "Aria", "Arjun", "Astrid", "Ayesha", "Bianca", "Bilal", "Bruno", "Camila", "Carlos", "Chen",
          "Chiara", "Chloe", "Daniel", "Dario", "Deepa", "Diego", "Dmitri", "Elena", "Elif", "Emeka",
          "Emma", "Ethan", "Fatima", "Felix", "Freya", "Gabriel", "Grace", "Hana", "Hassan", "Ines",
          "Isaac", "Ivan", "Jae", "Jamal", "James", "Javier", "Jin", "Jonas", "Julia", "Kai", "Kavya",
          "Kenji", "Kofi", "Lars", "Layla", "Leila", "Leon", "Lina", "Lucas", "Lucia", "Maya", "Mateo",
          "Mei", "Mohammed", "Nadia", "Naomi", "Nikhil", "Nina", "Noah", "Olga", "Omar", "Oscar", "Priya",
          "Rafael", "Rania", "Ravi", "Rosa", "Sakura", "Samuel", "Sara", "Sofia", "Tariq", "Thomas",
          "Tomas", "Uma", "Valentina", "Victor", "Wei", "Yara", "Yusuf", "Zara", "Zoe"]
_LAST = ["Abara", "Adeyemi", "Alvarez", "Andersen", "Bakker", "Banerjee", "Becker", "Bianchi", "Brooks",
         "Castillo", "Chen", "Costa", "Dang", "Dubois", "Eriksson", "Fernandes", "Fischer", "Garcia",
         "Ghosh", "Gomez", "Gupta", "Haddad", "Hansen", "Hernandez", "Hoang", "Hughes", "Ibrahim", "Ito",
         "Jansen", "Johnson", "Kaur", "Khan", "Kim", "Kowalski", "Kumar", "Larsen", "Lee", "Lopez",
         "Martin", "Mendes", "Moreau", "Mueller", "Murphy", "Nakamura", "Nguyen", "Novak", "Nowak",
         "Okafor", "Okoye", "Oliveira", "Park", "Patel", "Perez", "Petrov", "Popescu", "Quinn", "Rahman",
         "Ramirez", "Reddy", "Rossi", "Russo", "Saito", "Santos", "Schmidt", "Shah", "Silva", "Singh",
         "Smith", "Sokolov", "Suzuki", "Tan", "Taylor", "Torres", "Tran", "Walker", "Wang", "Weber",
         "Wong", "Yamamoto", "Yilmaz", "Zhang", "Zhou"]

_STATUS_WEIGHTS = [("active", 45), ("completed", 20), ("planned", 20), ("on_hold", 15)]
_ADMINS = [("Chief Technology Officer", 140), ("VP of Engineering", 125)]
_MANAGER_TITLES = [("Engineering Manager", (85, 98)), ("Senior Engineering Manager", (96, 110))]


def is_seeded() -> bool:
    """True once the large demo is in (its people, unlike the small demo's, have a dot in the email)."""
    return db.query_one("SELECT 1 AS hit FROM employees WHERE lower(email) LIKE %s LIMIT 1",
                        ("%.%@" + demo_seed.DOMAIN,)) is not None


def _weighted(rng: random.Random, pairs: list):
    return rng.choices([p[0] for p in pairs], weights=[p[1] for p in pairs])[0]


def _people(rng: random.Random) -> list:
    """500 unique (first, last) names, in the order drawn (a list, so the order never depends on hashing)."""
    names, seen = [], set()
    while len(names) < 500:
        name = (rng.choice(_FIRST), rng.choice(_LAST))
        if name not in seen:
            seen.add(name)
            names.append(name)
    return names


def _team_sizes(rng: random.Random, members: int) -> list:
    """len(TEAMS) sizes from 10 to 20 that add up to `members`."""
    sizes = [members // len(TEAMS)] * len(TEAMS)
    sizes[0] += members - sum(sizes)
    for _ in range(80):
        a, b = rng.randrange(len(sizes)), rng.randrange(len(sizes))
        if sizes[a] > 10 and sizes[b] < 20:
            sizes[a] -= 1
            sizes[b] += 1
    return sizes


def _member_title(rng: random.Random, kind: str) -> tuple:
    """(job title, hourly rate) for a team member of this kind of team."""
    roll, title = rng.random(), None
    for cross, chance in _CROSS_FUNCTIONAL:
        if roll < chance:
            title = cross
            break
        roll -= chance
    title = title or rng.choice(_TITLES[kind])
    level = _weighted(rng, [(lv, w) for lv, w, _ in _LEVELS])
    low, high = next(r for lv, _, r in _LEVELS if lv == level)
    return level + title, rng.randint(low, high)


def build(rng: random.Random, monday: datetime.date, today: datetime.date) -> dict:
    """The whole organisation as rows ready to insert (no database access)."""
    def day(offset: int) -> datetime.date:
        return monday + datetime.timedelta(days=offset)

    names = iter(_people(rng))
    employees, rates = [], {}

    def person(role: str, title: str, hourly: int, team_id=None) -> uuid.UUID:
        first, last = next(names)  # unique pairs, so the email is unique too
        pid = uuid.uuid4()
        employees.append((pid, f"{first}.{last}@{demo_seed.DOMAIN}".lower(), f"{first} {last}", role,
                          title, hourly * 2080, team_id))
        rates[pid] = hourly
        return pid

    for title, hourly in _ADMINS:
        person("admin", title, hourly)
    leads = []
    for _ in TEAMS:
        title, (low, high) = rng.choice(_MANAGER_TITLES)
        leads.append(person("manager", title, rng.randint(low, high)))

    sizes = _team_sizes(rng, 450)
    teams, members_of = [], {}
    for (name, kind, _), lead, size in zip(TEAMS, leads, sizes):
        tid = uuid.uuid4()
        teams.append((tid, name, lead))
        members_of[tid] = [person("employee", *_member_title(rng, kind), team_id=tid) for _ in range(size)]
    for _ in range(500 - len(employees)):  # the rest: not on a team yet
        person("employee", *_member_title(rng, rng.choice(list(_TITLES))))

    t = (today - monday).days  # today, as an offset from this week's Monday
    projects, deliverables, dependencies, allocations = [], [], [], []
    hours = collections.defaultdict(collections.Counter)  # person -> week start -> hours

    def allocate(pid, project_id, lead, start, end, wanted) -> int:
        """Add an allocation if the 40-hour rule allows `wanted` or less; returns its cost."""
        touched = weeks.weeks_touched(day(start), day(end))
        for h in (wanted, wanted // 2, 8, 4):
            if h >= 1 and all(hours[pid][w] + h <= 40 for w in touched):
                for w in touched:
                    hours[pid][w] += h
                allocations.append((uuid.uuid4(), pid, project_id, h, day(start), day(end), lead))
                return h * rates[pid] * len(touched)
        return 0

    for (tid, _, lead), (_, kind, project_names) in zip(teams, TEAMS):
        phases = _PHASES[_PHASES_BY_KIND[kind]]
        for name in project_names:
            status = _weighted(rng, _STATUS_WEIGHTS)
            if status == "completed":
                end = -7 * rng.randint(2, 30) + 4
                start = end - 4 - 7 * rng.randint(8, 30)
            elif status == "planned":
                start = 7 * rng.randint(1, 16)
                end = start + 4 + 7 * rng.randint(8, 34)
            else:  # active, on_hold
                start = -7 * rng.randint(2, 28)
                end = 7 * rng.randint(4, 36) + 4
            # Work is done (or stopped, for on_hold) as of this day.
            as_of = t - rng.randint(14, 45) if status == "on_hold" else t
            pid_ = uuid.uuid4()

            n = rng.randint(4, 6)
            picked = [phases[0]] + sorted(rng.sample(phases[1:-1], n - 2), key=phases.index) + [phases[-1]]
            span = end - start
            # Phases follow each other; in some projects one phase starts a few days before
            # the previous one is due, which the at-risk report shows as a date conflict.
            early = rng.randrange(1, n) if rng.random() < 0.15 else None
            states, ids = [], []
            for i, phase in enumerate(picked):
                d_start = start + i * span // n - (rng.randint(2, 4) if i == early else 0)
                d_due = start + (i + 1) * span // n - 1 if i < n - 1 else end
                deps = [i - 1] if i else []
                if i >= 2 and rng.random() < 0.25:
                    deps.append(i - 2)
                deps_done = all(states[d] == "done" for d in deps)
                if status == "completed":
                    state = "done"
                elif status == "planned" or not deps_done or d_start > as_of:
                    state = "not_started"
                elif d_due < as_of:
                    state = "done" if rng.random() < 0.9 else "in_progress"
                else:
                    state = "in_progress" if rng.random() < 0.8 else "not_started"
                states.append(state)
                did = uuid.uuid4()
                ids.append(did)
                completed_at = None
                if state == "done":
                    done_day = day(min(d_due, t - 1))
                    completed_at = datetime.datetime.combine(done_day, datetime.time(16, 0),
                                                             tzinfo=datetime.timezone.utc)
                deliverables.append((did, pid_, phase, state, day(d_start), day(d_due), completed_at))
                dependencies.extend((did, ids[d]) for d in deps)

            cost = 0
            team = members_of[tid]
            if status == "planned" and rng.random() < 0.4:
                staffed = []
            else:
                count = {"active": (3, 7), "completed": (3, 6), "on_hold": (2, 4), "planned": (2, 4)}[status]
                staffed = rng.sample(team, min(len(team), rng.randint(*count)))
            for member in staffed:
                a_start = start + 7 * rng.randint(0, max(0, span // 21))
                a_end = end - 7 * rng.randint(0, max(0, span // 28))
                if status == "on_hold":
                    a_end = min(a_end, as_of)
                if a_start > a_end:
                    continue
                wanted = rng.choice([8, 10, 12, 16, 16, 20, 20, 24, 30])
                cost += allocate(member, pid_, lead, a_start, a_end, wanted)

            if rng.random() < 0.1:
                budget = None
            elif cost:
                budget = round(cost * rng.uniform(0.9, 1.7), -3)
            else:
                budget = 1000 * rng.randint(20, 200)
            projects.append((pid_, tid, name, status, day(start), day(end), budget))

    return {"employees": employees, "teams": teams, "projects": projects,
            "deliverables": deliverables, "dependencies": dependencies, "allocations": allocations}


def _insert(table: str, columns: tuple, rows: list) -> None:
    """Multi-row INSERTs of `rows` in batches. Table and column names are constants here."""
    placeholders = "(" + ", ".join(["%s"] * len(columns)) + ")"
    for i in range(0, len(rows), _BATCH):
        chunk = rows[i:i + _BATCH]
        db.execute(f"INSERT INTO {table} ({', '.join(columns)}) VALUES "
                   + ", ".join([placeholders] * len(chunk)),
                   [value for row in chunk for value in row])


def seed(passwords: dict, monday: Optional[datetime.date] = None) -> dict:
    """Insert the large demo in one transaction; returns how many rows of each kind.

    `passwords` maps each role to its password (the same as the small demo's).
    """
    today = weeks.today()
    monday = monday or weeks.week_start(today)
    org = build(random.Random(SEED), monday, today)
    hashes = {role: auth.hash_password(passwords[role]) for role in demo_seed.ROLES}
    people = org["employees"]
    without_team = [(pid, email, name, role, hashes[role], title, salary)
                    for pid, email, name, role, title, salary, team in people if team is None]
    with_team = [(pid, email, name, role, hashes[role], title, salary, team)
                 for pid, email, name, role, title, salary, team in people if team is not None]
    with db.transaction():
        # Leads exist before their teams, and teams before their members.
        _insert("employees", ("id", "email", "name", "role", "password_hash", "job_title", "salary"),
                without_team)
        _insert("teams", ("id", "name", "lead_id"), org["teams"])
        _insert("employees", ("id", "email", "name", "role", "password_hash", "job_title", "salary",
                              "team_id"), with_team)
        _insert("projects", ("id", "team_id", "name", "status", "start_date", "end_date",
                             "planned_budget"), org["projects"])
        _insert("deliverables", ("id", "project_id", "name", "status", "start_date", "due_date",
                                 "completed_at"), org["deliverables"])
        _insert("deliverable_dependencies", ("deliverable_id", "depends_on_id"), org["dependencies"])
        _insert("allocations", ("id", "employee_id", "project_id", "hours_per_week", "start_date",
                                "end_date", "created_by"), org["allocations"])
        counts = {kind: len(rows) for kind, rows in org.items()}
        audit.record("demo_bulk_seeded", None, None, None, counts)
    return counts
