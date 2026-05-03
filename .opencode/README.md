# OpenCode: AI Development Environment

Полноценная среда разработки с AI-агентами для OpenCode. 60+ специализированных агентов, 25+ скиллов, MCP-серверы, RAG-инфраструктура (Qdrant), система управления задачами (Beads) и мульти-агентная оркестрация — доступны глобально в любом проекте.

## Быстрый старт

```bash
# Установка окружения
bash install.sh

# Инициализация проекта
/project-setup

# Разработка через тимлида
/teamlead "Создать API для управления пользователями"

# Прямой вызов агента
@spec-developer Реализовать middleware авторизации
```

## Пошаговый workflow

### Шаг 1: Установка

Запустите установщик, который настроит всё необходимое:

```bash
bash install.sh
```

**Что делает Ansible:**
- Устанавливает Claude Code / OpenCode
- Создаёт симлинк `~/.claude/` → `.claude/` этого репозитория
- Поднимает Docker-контейнер Qdrant для RAG
- Устанавливает MCP-серверы (qdrant-mcp, code-index-mcp, context7, mem0)
- Настраивает OpenPencil для работы с дизайном
- Устанавливает инструменты Beads (task management) и Gastown (multi-agent orchestration)

**Проверка RAG:**
```bash
# Qdrant health check
curl -s http://localhost:6333/healthz

# Запуск если остановлен
docker start qdrant

# Проверка MCP-серверов
claude mcp list
```

### Шаг 2: Описание проекта

Инициализируйте проект для AI-разработки:

```bash
/project-setup
```

**Что создаётся:**
- `docs/Constitution.md` — правила для всех агентов
- `docs/architecture/overview.md` — архитектура системы
- `docs/project.yaml` — конфигурация проекта
- `docs/requirements.md` — функциональные требования
- Контекст-файлы для агентов

**Авто-детект тимлидом:**
При первом вызове `/teamlead` система автоматически определяет:
- Тип проекта (React/Vue/Node/Python/Go и т.д.)
- Размер кодовой базы (repomix vs RAG)
- Необходимые MCP-серверы
- Подходящий workflow template

### Шаг 3: Разработка через тимлида

Team Lead — чистый оркестратор. Он не пишет код, а управляет процессом:

```
Пользователь → team-lead → spec-analyst → spec-architect → agile-master
                                              ↓
                                        senior-*-architects
                                              ↓
                                  spec-developer, spec-reviewer, spec-tester
```

**Workflow Templates:**

| Template | Фазы | Quality | Когда использовать |
|----------|------|---------|-------------------|
| **feature** | analyst → architect → agile-master → dev → review → test → validate | 95% | Новые фичи |
| **bugfix** | dev → review → test | 90% | Исправление багов |
| **hotfix** | dev → test | 85% | Критические фиксы |
| **refactor** | architect → dev → review → test | 95% | Рефакторинг |
| **docs** | writer → architecture-keeper | review | Документация |
| **prototype** | architect → dev | 75% | Прототипирование |

**Пример:**
```bash
/teamlead "Добавить систему уведомлений с email и push"
```

Тимлид автоматически:
1. Запустит preflight-checker для проверки инфраструктуры
2. Создаст задачи через spec-analyst
3. Спланирует архитектуру через spec-architect
4. Разобьёт на фазы через agile-master
5. Назначит разработчиков и ревьюеров
6. Проконтролирует качество через quality gates

### Шаг 4: Прямая работа с агентами

Для независимых задач используйте прямой вызов:

```bash
# Frontend
@react-developer Создать компонент Button с вариантами
@vue-frontend-engineer Настроить Vue Router

# Backend
@nodejs-developer Реализовать JWT-аутентификацию
@golang-developer Создать gRPC-сервис

# DevOps
@deployment-engineer Настроить CI/CD pipeline
@devops-troubleshooter Диагностировать падение контейнера

# Параллельный запуск
@frontend-ui-ux Создать макет страницы & @backend-dev Спроектировать API
```

## Агенты

Все 63 агента сгруппированы по категориям:

### Spec-агенты (9)

| Агент | Роль | Модель |
|-------|------|--------|
| **team-lead** | Главный оркестратор, управляет workflow | opus |
| **spec-analyst** | Анализ требований, создание user stories | opus |
| **spec-architect** | Системное проектирование, технические решения | opus |
| **spec-planner** | Планирование реализации, декомпозиция | opus |
| **agile-master** | Управление фазами, приоритеты, workflow | opus |
| **spec-developer** | Разработка кода | sonnet |
| **spec-reviewer** | Код-ревью | opus |
| **spec-tester** | Написание тестов | sonnet |
| **spec-validator** | Финальная валидация | sonnet |

### Оркестрация (2)

| Агент | Роль |
|-------|------|
| **preflight-checker** | Проверка инфраструктуры перед запуском workflow |
| **release-manager** | Управление релизами, CHANGELOG, версионирование |

### Фронтенд (6)

| Агент | Специализация |
|-------|---------------|
| **senior-frontend-architect** | Архитектура фронтенда, оркестрация |
| **react-developer** | React + Next.js |
| **vue-frontend-engineer** | Vue.js + Nuxt |
| **angular-frontend-engineer** | Angular |
| **svelte-developer** | Svelte/SvelteKit |
| **front-lead** | Консультации по стандартам, дизайн-система |

### Бэкенд (5)

| Агент | Специализация |
|-------|---------------|
| **senior-backend-architect** | Архитектура бэкенда, микросервисы |
| **nodejs-developer** | Node.js, Express, NestJS |
| **golang-developer** | Go, микросервисы |
| **php-developer** | PHP, Laravel, Symfony |
| **dotnet-developer** | .NET, C# |

### DevOps (4)

| Агент | Специализация |
|-------|---------------|
| **senior-devops-architect** | DevOps-архитектура, инфраструктура |
| **deployment-engineer** | CI/CD, деплой |
| **devops-troubleshooter** | Диагностика проблем |
| **monorepo-architect** | Nx, Turborepo, pnpm workspaces |

### Безопасность (3)

| Агент | Специализация |
|-------|---------------|
| **security-architect** | Безопасность, аудит, OWASP |
| **compliance-officer** | Соответствие стандартам (GDPR, SOC2) |
| **performance-engineer** | Оптимизация производительности |

### Дизайн (2)

| Агент | Специализация |
|-------|---------------|
| **ui-ux-master** | UI/UX дизайн |
| **open-pencil-designer** | Работа с Figma, OpenPencil |

### Доменные (7)

| Агент | Специализация |
|-------|---------------|
| **database-architect** | Проектирование БД |
| **api-designer** | REST/GraphQL API |
| **payments-specialist** | Платёжные системы |
| **search-specialist** | Поиск (Elasticsearch, Algolia) |
| **realtime-specialist** | WebSocket, SSE, realtime |
| **ml-engineer** | Machine Learning |
| **mobile-developer** | React Native, мобильная разработка |

### Утилиты (9)

| Агент | Специализация |
|-------|---------------|
| **git-historian** | История git, bisect, blame |
| **changelog-keeper** | CHANGELOG, conventional commits |
| **boilerplate-generator** | Генерация шаблонов |
| **regex-helper** | Регулярные выражения |
| **readme-generator** | Генерация README |
| **migration-assistant** | Миграции БД |
| **dependency-auditor** | Аудит зависимостей |
| **refactor-agent** | Рефакторинг кода |
| **sql-optimizer** | Оптимизация SQL |

### Остальные агенты

| Категория | Агенты |
|-----------|--------|
| **Документация** | technical-writer, architecture-keeper, api-documenter |
| **Продукт** | product-manager, growth-engineer |
| **Исследования** | competitor-analyst, trend-watcher, docs-collector, web-researcher |
| **Коммуникации** | meeting-summarizer, email-composer |
| **Принятие решений** | decision-helper, learning-planner, task-prioritizer |
| **Данные** | data-engineer, data-analyst |

## Скиллы

### Superpowers (14 навыков)

Из репозитория [obra/superpowers](https://github.com/obra/superpowers):

| Скилл | Назначение |
|-------|------------|
| **brainstorming** | Исследование требований перед разработкой |
| **writing-plans** | Создание планов реализации |
| **test-driven-development** | TDD перед написанием кода |
| **systematic-debugging** | Системный подход к отладке |
| **verification-before-completion** | Проверка перед завершением |
| **receiving-code-review** | Обработка code review |
| **requesting-code-review** | Запрос code review |
| **subagent-driven-development** | Разработка через субагентов |
| **dispatching-parallel-agents** | Параллельный запуск агентов |
| **executing-plans** | Выполнение планов |
| **using-git-worktrees** | Работа с git worktrees |
| **finishing-a-development-branch** | Завершение веток |
| **using-superpowers** | Обнаружение и использование скиллов |
| **writing-skills** | Создание новых скиллов |

### Кастомные инструкции (30 файлов)

Сгруппированы по назначению:

**Разработка:**
- `brainstorming`, `writing-plans`, `test-driven-development`, `systematic-debugging`
- `verification-before-completion`, `receiving-code-review`, `requesting-code-review`
- `subagent-driven-development`, `dispatching-parallel-agents`, `executing-plans`

**Git & Workflow:**
- `using-git-worktrees`, `finishing-a-development-branch`

**Core:**
- `using-superpowers`, `writing-skills`

**Проектные:**
- `directives`, `project-setup`, `teamlead`, `team-comms`, `rag-context`, `rag-setup`

**Инструменты:**
- `beads-tasks`, `gastown-orchestrate`, `repomix-snapshot`, `code-search`, `agent-creator`, `agent-workflow`

**Доменные:**
- `backend-dev`, `devops`, `system-design`, `ai-product-dev`, `analytics`, `monorepo`

**Утилиты:**
- `research`, `docs`, `changelog`, `readme`, `migrate`, `audit`, `learn`, `decide`, `update-ai`, `figma-to-pencil`, `find-skills`

## Команды (18 шт)

### Разработка

| Команда | Назначение |
|---------|------------|
| `/implement` | Реализовать фичу с планированием и тестами |
| `/debug` | Системная отладка проблемы |
| `/test` | Сгенерировать тесты для модуля |
| `/refactor` | Рефакторинг с сохранением поведения |
| `/design` | Создать документ архитектуры |

### Workflow

| Команда | Назначение |
|---------|------------|
| `/workflow-feature` | Полный pipeline для фичи (95% quality) |
| `/workflow-bugfix` | Pipeline для багфикса (90% quality) |
| `/workflow-hotfix` | Ускоренный pipeline (85% quality) |
| `/workflow-refactor` | Pipeline для рефакторинга (95% quality) |
| `/workflow-docs` | Pipeline для документации |
| `/workflow-prototype` | Pipeline для прототипа (75% quality) |

### Анализ

| Команда | Назначение |
|---------|------------|
| `/pr-review` | Ревью PR или staged changes |
| `/security-audit` | Аудит безопасности |
| `/context-prime` | Загрузка контекста для агентов |
| `/onboard` | Исследование кодовой базы |
| `/commit` | Создание коммита |

### Инструменты

| Команда | Назначение |
|---------|------------|
| `/agent-creator` | Создать нового агента |
| `/agent-workflow` | Автоматизированный workflow |

## Плагины

| Плагин | Что делает | Как улучшает работу |
|--------|------------|---------------------|
| **superpowers** | Навыки разработки (TDD, debugging, planning) | Структурированный подход к задачам |
| **opencode-dynamic-context-pruning** | Динамическая очистка контекста | Экономия токенов, скорость ответов |
| **opencode-shell-strategy** | Умная стратегия shell-команд | Безопасность и эффективность Bash |
| **opencode-devcontainers** | Поддержка devcontainers | Изолированные среды разработки |
| **opencode-type-inject** | Инъекция типов TypeScript | Лучшая типизация кода |
| **opencode-vibeguard** | Защита от "vibe coding" | Контроль качества |
| **opencode-notifier** | OS-уведомления | Оповещение о завершении задач |
| **opencode-skillful** | Управление скиллами | Авто-обнаружение и загрузка |
| **opencode-worktree** | Работа с git worktrees | Изолированные ветки |
| **oh-my-opencode** | Core плагин инфраструктуры | Базовая функциональность |
| **opencode-pty** | PTY сессии | Интерактивные терминалы |

### ASCII-схема: `/teamlead "Создать страницу логина"`

```
┌─────────────────────────────────────────────────────────────┐
│                    User Request                             │
│          /teamlead "Создать страницу логина"                │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  oh-my-opencode (инициализация, загрузка конфига)          │
│  superpowers (проверка скиллов brainstorming)              │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  opencode-dynamic-context-pruning                           │
│  └─► Оценка размера контекста                               │
│      ├─► Если <=700k: repomix strategy                      │
│      └─► Если >700k: RAG strategy (Qdrant)                  │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  team-lead агент                                            │
│  ├─► Создаёт context pack для sub-агентов                   │
│  └─► Определяет workflow (feature template)                 │
└───────────────────────┬─────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  superpowers │ │  opencode-   │ │  opencode-   │
│  (планирование│ │  skillful    │ │  notifier    │
│  через        │  │  (загрузка   │  │  (старт      │
│  writing-plans)│ │  нужных      │  │  уведомления)│
└──────────────┘ └──────────────┘ └──────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  Параллельный spawn агентов:                                │
│  ├─► spec-analyst (требования)                              │
│  ├─► senior-frontend-architect (UI)                         │
│  └─► senior-backend-architect (API)                         │
│                                                             │
│  opencode-pty (если нужен dev server)                       │
│  opencode-devcontainers (если настроен)                     │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  Результаты → spec-developer → spec-reviewer                │
│  opencode-vibeguard (контроль качества)                     │
│  verification-before-completion (проверка)                  │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  opencode-notifier (завершение)                             │
│  opencode-worktree (если использовались worktrees)          │
└─────────────────────────────────────────────────────────────┘
```

## MCP-серверы

| Сервер | Назначение | Кто использует |
|--------|------------|----------------|
| **qdrant-mcp** | Векторный поиск, хранение знаний | RAG агенты |
| **code-index-mcp** | Семантический поиск по коду | Все dev-агенты |
| **context7** | Документация библиотек | Frontend, Backend агенты |
| **docfork** | MIT-документация без rate limits | Все агенты |
| **tree-sitter** | AST-анализ кода | spec-reviewer, refactor-agent |
| **sequential-thinking** | Многошаговое мышление | spec-architect, planning агенты |
| **playwright** | Браузерная автоматизация | spec-tester, frontend агенты |
| **figma-bridge** | Интеграция с Figma | ui-ux-master, open-pencil-designer |
| **memorix** | Память агентов | Все агенты |

## Контекст-стратегия

Трёхуровневая модель управления контекстом:

### Layer 1: Core Context (~15-20k токенов)
- Constitution, инструкции агентов
- Текущая задача и история
- Доступные инструменты и MCP

### Layer 2: Project Context (~50-100k токенов)
- Архитектура проекта
- Конфигурация (project.yaml)
- Ключевые файлы (readme, package.json и т.д.)

### Layer 3: Codebase Context (переменный)

| Стратегия | Порог | Как работает |
|-----------|-------|--------------|
| **repomix** | <=700k токенов | Полный snapshot кодовой базы |
| **RAG** | >700k токенов | Query Qdrant + code-index-mcp |

**Выбор стратегии:**
```bash
# Авто-определение (default)
context: strategy: auto

# Принудительно repomix
context: strategy: repomix

# Принудительно RAG
context: strategy: rag
```

## Модель

Субагенты наследуют модель родительской сессии:

| Родительская сессия | Субагенты получают |
|---------------------|-------------------|
| **DeepSeek** | DeepSeek |
| **Kimi** | Kimi |
| **Claude** | Claude (opus/sonnet/haiku по назначению) |

**Маршрутизация моделей внутри системы:**

| Тип задачи | Модель | Агенты |
|------------|--------|--------|
| Планирование, архитектура | opus | team-lead, spec-analyst, spec-architect, agile-master, spec-planner |
| Разработка, исполнение | sonnet | spec-developer, senior-*-architects, domain агенты |
| Механические задачи | haiku | changelog-keeper, boilerplate-generator, regex-helper |

## Структура проекта

```
/Users/zeizel/projects/ai-config/
├── .opencode/                    # OpenCode конфигурация
│   ├── agent/                    # 63+ агентов
│   │   ├── team-lead.md
│   │   ├── spec-analyst.md
│   │   ├── spec-architect.md
│   │   ├── senior-frontend-architect.md
│   │   ├── senior-backend-architect.md
│   │   ├── spec-developer.md
│   │   └── ...
│   ├── skills/                   # 30+ кастомных скиллов
│   │   ├── teamlead/
│   │   ├── project-setup/
│   │   ├── rag-context/
│   │   └── ...
│   ├── commands/                 # 18 slash-команд
│   │   ├── implement.md
│   │   ├── debug.md
│   │   ├── workflow-feature.md
│   │   └── ...
│   ├── instructions/             # Глобальные инструкции
│   │   ├── using-superpowers.md
│   │   ├── test-driven-development.md
│   │   └── ...
│   ├── hooks/                    # Event hooks
│   │   ├── post_tool_use.ts
│   │   ├── pre_tool_use.ts
│   │   └── ...
│   ├── opencode.json             # Основная конфигурация
│   └── templates/                # Шаблоны для новых проектов
│
├── .claude/                      # Claude Code конфигурация (backward compat)
│   └── ... (mirrors .opencode)
│
├── docs/                         # Проектная документация
│   ├── Constitution.md           # Правила для всех агентов
│   ├── project.yaml              # Конфигурация проекта
│   ├── requirements.md           # Требования
│   ├── architecture/             # Архитектурные спеки
│   └── ...
│
├── roles/                        # Ansible роли
│   ├── claude/                   # Установка Claude Code
│   └── ai/                       # RAG + MCP инфраструктура
│
├── install.sh                    # Главный установщик
├── setup-ai.sh                   # Только AI инфраструктура
└── README.md                     # Этот файл
```

## Быстрые сценарии

### Сценарий 1: Новая фича

```bash
# Шаг 1: Инициализация (если новый проект)
/project-setup

# Шаг 2: Запуск фичи через тимлида
/teamlead "Добавить систему уведомлений с email-рассылкой и WebSocket push"

# Тимлид автоматически:
# - Создаст задачи через spec-analyst
# - Спланирует архитектуру через spec-architect
# - Разобьёт на фазы через agile-master
# - Назначит spec-developer, spec-reviewer, spec-tester
# - Проконтролирует 95% quality gate
```

### Сценарий 2: Исправление бага

```bash
# Прямой вызов для быстрого фикса
/workflow-bugfix

# Или через тимлида для сложного бага
/teamlead "Исправить ошибку 500 при создании пользователя с дублирующим email"

# Pipeline: dev -> review -> test (90% quality)
```

### Сценарий 3: Рефакторинг

```bash
# Рефакторинг с архитектурным контролем
/workflow-refactor

# Или конкретная задача
@refactor-agent Вынести валидацию в отдельный модуль

# Pipeline: architect -> dev -> review -> test (95% quality)
```

### Сценарий 4: Безопасность

```bash
# Полный аудит
/security-audit

# Конкретная проверка
@security-architect Проверить аутентификацию на OWASP Top 10

# Комплаенс
@compliance-officer Проверить GDPR compliance
```

### Сценарий 5: Новый проект

```bash
# Шаг 1: Установка окружения
bash install.sh

# Шаг 2: Инициализация проекта
/project-setup

# Шаг 3: Архитектура
/design "Создать архитектуру для e-commerce платформы"

# Шаг 4: Первая фича
/workflow-feature
```

### Сценарий 6: Параллельная разработка

```bash
# Параллельный запуск независимых задач
@react-developer Создать компоненты формы & \
@nodejs-developer Реализовать API endpoints & \
@database-architect Спроектировать схему БД

# Или через тимлида с оркестрацией
/teamlead "Создать полноценный модуль аутентификации: UI + API + БД"
# Тимлид автоматически распараллелит работу между агентами
```

---

## Полезные ссылки

- [Constitution](docs/Constitution.md) — обязательные правила для всех агентов
- [Agents Catalog](.opencode/docs/agents/) — полный каталог агентов
- [Skills Catalog](.opencode/docs/skills/) — каталог скиллов
- [Architecture](docs/architecture/overview.md) — архитектура системы

## Поддержка

Если что-то не работает:

```bash
# Проверка инфраструктуры
@preflight-checker

# Проверка MCP-серверов
claude mcp list

# Проверка Qdrant
curl -s http://localhost:6333/healthz
```
