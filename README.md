# Coding Workshop

The goal of this coding workshop is to enable and assess the hands-on skills
of participants through development of a practical technical solution that
solves a theoretical business problem.

## Getting Started

Navigate to [Coding Workshop - Main Guide](./docs/README.md) to get started.

## Coding Workshop Example

Coding workshop organizer(s) will provide instructions to follow by email. Here
below is a real example of requirements and expectations for participant(s):

### Requirements: Business Problem

Our company ACME Inc. is going through a massive organizational transformation
to become a more data-driven organization. Information about teams structure
and performance is currently scattered across multiple systems, making it
difficult to get a comprehensive view of team dynamics and achievements.

We are struggling to answer simple questions like:

* Who are the members of each team?
* Where are the teams located?
* What are the key achievements of each team on a monthly basis?
* How many teams have team leader not co-located with team members?
* How many teams have team leader as a non-direct staff?
* How many teams have non-direct staff to employees ratio above 20%?
* How many teams are reporting to an organization leader?

### Requirements: Technical Solution

As part of this transformation, we are looking to build a centralized team
management tool that will allow us to track team members, team locations,
monthly team achievements, as well as individual-level and team-level metadata.
Initial focus is to provide a self-service capability without any integrations
with other tools such as Employee Directory, Project Tracking, or Performance
Management.

The technical solution involves developing a stand-alone web application using
modern technologies. The application will have the following features:

* User authentication and authorization
* Role-based access control
* CRUD operations for individuals, teams, achievements and metadata
* Search and filter functionality
* Responsive design for mobile and desktop usage

### Requirements: Technology Stack

The following technologies are required to build the application:

* Frontend: HTML, CSS, React.js with React Responsive and Material UI Components
* Backend: Python
* Database: PostgreSQL

The following technologies are good to know, as they are used to manage and
deploy code:

* Version Control: Git, GitHub
* Infrastructure: Terraform
* Deployment Mode: Shell Scripts
* Deployment Target: AWS Serverless (e.g. S3, CloudFront, Lambda, RDS)

### Expectations: Value-Based Outcomes

By the end of the workshop, participants will have developed a functional
web application that meets the requirements outlined above. The application
will be deployed to a cloud environment and accessible via a web browser.
Participants will also gain hands-on experience with modern web development
technologies and best practices.

## Deploy notes

Four new backend services (see [docs/api-contract.md](./docs/api-contract.md)),
plus a change to `employees`. Each is a Python Lambda that Terraform finds by
its `requirements.txt` (`infra/locals.tf`), with handler `function.handler` and
a CloudFront route `/api/<name>*`. No infra changes are needed.

What every service needs on deploy:

* **Shared code copied in:** run `./scripts/sync-common.sh` first, so each
  service folder gets its own `common/` (never committed).
* **Python packages:** `PyJWT` and `pg8000` from its `requirements.txt`.
* **Environment:** the usual `POSTGRES_HOST/PORT/NAME/USER/PASS`. All services
  must share the same `POSTGRES_PASS`: the access-token key is derived from it.
  `IS_LOCAL` must not be `true` in the cloud (TLS to the database).
* **Database rights:** the first cold start of *any* service applies pending
  migrations (lock-protected, safe to race), so the DB user needs DDL rights.

| Service | Path | Needs | Notes |
|---|---|---|---|
| `teams` | `/api/teams` | migration 002 | Uses `DELETE` (remove member); CloudFront already allows it. |
| `projects` | `/api/projects` | migrations 002–006 | Deliverables live under `/api/projects/{id}/deliverables`. |
| `allocations` | `/api/allocations` | migrations 002–006 | 40-hour check locks the employee row (`SELECT ... FOR UPDATE`). |
| `reports` | `/api/reports` | migrations 002–006 | Read-only queries, but still runs migrations on cold start. |
| `employees` (changed) | `/api/employees` | migration 002 | Redeploy: returns `team_id`, and refuses to demote or archive a team lead. |

Deploy all five together: the old `employees` code keeps working against the
new schema, but the new services need the tables and columns from 002–006
(006 adds `projects.planned_budget`).

Local only: `scripts/dev_server.py` serves all services on port 3001, and
`scripts/seed_demo.py` fills a local database with demo data (passwords from
`DEMO_ADMIN_PASSWORD`, `DEMO_MANAGER_PASSWORD`, `DEMO_EMPLOYEE_PASSWORD`).

## Contributing

See the [CONTRIBUTING](./CONTRIBUTING.md) resource for more details.

## License

This library is licensed under the MIT-0 License.
See the [LICENSE](./LICENSE) resource for more details.

## Roadmap

See the
[open issues](https://github.com/citi/coding-workshop-participant/issues)
for a list of proposed roadmap features (and known issues).

## Security

See the
[Security Issue Notifications](./CONTRIBUTING.md#security-issue-notifications)
resource for more details.

## Authors

The following people have contributed to this workshop:

* Colin Heilman - [@heilmancs](https://github.com/heilmancs)
* Eugene Istrati - [@eistrati](https://github.com/eistrati)
* Isaiah Cornelius Smith - [@corneliusmith](https://github.com/corneliusmith)
* Juan Arevalo - [@jparevalo27](https://github.com/jparevalo27)
* Michael Annucci - [@michael-annucci](https://github.com/michael-annucci)

## Feedback

We'd love to hear your feedback! Please:

* ⭐ Star the repository if you find it helpful
* 🐛 Report issues on GitHub
* 💡 Suggest improvements
* 📝 Share your experience
