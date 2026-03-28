# TOP-20 инструментов для мультиагентной AI-разработки (2026)

**Дата**: 2026-03-28
**Исследователь**: AI Assistant
**Глубина исследования**: Deep Dive
**Источников**: 40+

---

## 1. Executive Summary

Экосистема инструментов для мультиагентной AI-разработки в 2026 году достигла зрелости. Если в 2024 году разработчики работали с одним LLM через чат, то сейчас стандартом стал **оркестрированный пайплайн** из десятков специализированных агентов, объединённых через Model Context Protocol (MCP), с персистентной памятью, семантическим поиском по кодовой базе и CI/CD-автоматизацией.

Ключевые тренды:
- **MCP как универсальный протокол** -- стандарт, переданный Linux Foundation, поддерживаемый Anthropic, OpenAI и Google DeepMind. Более 50 000 звёзд у Context7 показывают массовое принятие.
- **Персистентная память агентов** -- Beads (18.9k звёзд) и Mem0 (51k звёзд) решают проблему "50 первых свиданий", когда агент каждый раз начинает с чистого листа.
- **Семантический поиск по коду** -- AST-aware chunking через tree-sitter стал стандартом. Claude Context, Qdrant MCP и Sourcegraph Cody обеспечивают поиск по смыслу, а не по ключевым словам.
- **Design-as-Code** -- Figma MCP и OpenPencil позволяют агентам работать с дизайном напрямую, создавая замкнутый цикл "дизайн-код-дизайн".
- **Spec-Driven Development** -- GitHub Spec-Kit (28k звёзд) формализует подход "спецификация первична", совместимый с любым агентным CLI.

Для нашего стека **ai-config** ключевые рекомендации: интеграция Beads как слоя памяти, замена Context7 на Docfork (MIT, без лимитов), добавление Claude Context для семантического поиска по коду и подключение Claude Code Action для CI/CD.

---

## 2. Сводная таблица инструментов

| # | Инструмент | Категория | Звёзды | Интеграция с Claude Code | Лицензия |
|---|-----------|-----------|--------|--------------------------|----------|
| 1 | [Ruflo](#1-ruflo) | Оркестрация | 27.6k | CLI, MCP (259 tools) | MIT |
| 2 | [Gas Town](#2-gas-town) | Оркестрация | 13.1k | CLI (gt), Beads | MIT |
| 3 | [Beads](#3-beads) | Управление задачами / Память | 18.9k | CLI (bd), Git-backed | MIT |
| 4 | [Mem0](#4-mem0) | Память агентов | 51.1k | MCP server, SDK | Apache-2.0 |
| 5 | [Repomix](#5-repomix) | Контекст / Упаковка кода | 22.4k | CLI, MCP server | MIT |
| 6 | [Claude Code Action](#6-claude-code-action) | CI/CD | 81.6k (claude-code) | GitHub Actions | MIT |
| 7 | [Context7](#7-context7) | Контекст / Документация | 50.1k | MCP server | Proprietary |
| 8 | [Docfork](#8-docfork) | Контекст / Документация | ~2k | MCP server | MIT |
| 9 | [GitHub Spec-Kit](#9-github-spec-kit) | Design / Спецификации | 28k | CLI (specify) | MIT |
| 10 | [Claude Agent SDK](#10-claude-agent-sdk) | Оркестрация / SDK | N/A (official) | Python, TypeScript SDK | MIT |
| 11 | [Claude Context (Zilliz)](#11-claude-context) | RAG / Поиск по коду | 5.2k | MCP server | MIT |
| 12 | [Qdrant](#12-qdrant) | RAG / Векторная БД | 29k | Docker, MCP server | Apache-2.0 |
| 13 | [Figma MCP](#13-figma-mcp) | Дизайн | N/A (official) | MCP server, Plugin | Proprietary |
| 14 | [OpenPencil](#14-openpencil) | Дизайн | 3.0k | MCP server (87 tools) | MIT |
| 15 | [Tree-sitter MCP](#15-tree-sitter-mcp) | Анализ кода / AST | ~1.5k | MCP server | MIT |
| 16 | [Sequential Thinking MCP](#16-sequential-thinking-mcp) | Рассуждения | N/A (official) | MCP server | MIT |
| 17 | [claude-code-templates (davila7)](#17-claude-code-templates) | Шаблоны / Агенты | 23.3k | CLI (npx) | MIT |
| 18 | [wshobson/agents](#18-wshobsonagents) | Плагины / Оценка | ~1k | Claude Code Plugin | MIT |
| 19 | [Claude-Code-Workflow (catlog22)](#19-claude-code-workflow) | Воркфлоу-движок | 1.5k | CLI (/ccw), MCP | MIT |
| 20 | [Sourcegraph Cody](#20-sourcegraph-cody) | Поиск по коду / IDE | N/A (commercial) | VS Code, JetBrains | Proprietary |

---

## 3. Детальные описания

### #1. Ruflo

**URL**: [github.com/ruvnet/ruflo](https://github.com/ruvnet/ruflo)
**Категория**: Оркестрация
**Звёзды**: 27.6k | **Форки**: 3k
**Интеграция**: CLI, MCP (259 tools), самостоятельная платформа

**Что делает**: Полноценная платформа оркестрации мультиагентных систем для Claude Code. Координирует 60+ специализированных агентов через swarm-архитектуру с самообучающейся памятью, консенсусными протоколами и отказоустойчивостью. Ранее известна как Claude Flow.

**Почему важен для мультиагентной разработки**: Ruflo -- единственная платформа, предлагающая интеллектуальную маршрутизацию задач по трём уровням сложности: простые задачи обрабатываются WASM-трансформами без LLM-вызовов, средние -- лёгкими моделями (Haiku), сложные -- полными агентными swarm'ами. Заявлено снижение API-затрат на 75%. Поддерживает мульти-модельную маршрутизацию (Claude, GPT, Gemini, Cohere, локальные модели).

**Установка**:
```bash
npx ruflo@latest init
```

**Ключевые компоненты**: SONA routing engine (0.05ms решения), AgentDB v3 (8 контроллеров памяти), ReasoningBank WASM, 259 MCP tools.

---

### #2. Gas Town

**URL**: [github.com/steveyegge/gastown](https://github.com/steveyegge/gastown)
**Категория**: Оркестрация
**Звёзды**: 13.1k | **Форки**: 1.2k
**Интеграция**: CLI (gt), Claude Code, GitHub Copilot, Codex

**Что делает**: Мультиагентный workspace manager от Steve Yegge. "Мэр" (Mayor) координирует работу "Polecats" (параллельных исполнителей) через Git worktrees и Beads. Каждый worker получает отдельный worktree, задачу из Beads и работает до завершения.

**Почему важен**: Реализует парадигму "разработчик как оператор завода", управляющий swarm'ом агентов. GUPP-принцип ("если на твоём крюке есть работа -- ТЫ ОБЯЗАН её выполнить") обеспечивает безостановочное выполнение. MEOW-стек (Beads, Epics, Molecules, Protomolecules, Formulas) даёт многоуровневую абстракцию workflow.

**Установка**:
```bash
brew install gastown
# или
npm install -g @gastown/gt
# или
go install github.com/steveyegge/gastown/cmd/gt@latest
```

**Предупреждение**: Высокая стоимость -- ~$100/час в Claude-токенах. Подходит для амбициозных проектов с большими бюджетами.

---

### #3. Beads

**URL**: [github.com/steveyegge/beads](https://github.com/steveyegge/beads)
**Категория**: Управление задачами / Память агентов
**Звёзды**: 18.9k | **Форки**: 1.2k
**Интеграция**: CLI (bd), Git-backed, JSON output

**Что делает**: Распределённый, Git-backed issue tracker, оптимизированный для AI-агентов. Решает проблему "50 первых свиданий" -- агенты просыпаются с памятью о вчерашней работе. Dolt-powered с cell-level merge, нативным branching и встроенной синхронизацией.

**Почему важен**: Стал де-факто стандартом управления задачами для Claude Code. Агент вызывает `bd ready --json` и получает чистый список неблокированных приоритетных задач. Закрытые задачи семантически сжимаются (compaction), чтобы не раздувать контекстное окно. Hash-based ID (bd-a1b2) исключают конфликты при мультиагентной работе.

**Установка**:
```bash
brew install beads
# или
npm install -g beads
# или
go install github.com/steveyegge/beads@latest
```

**Уже в нашем стеке**: Да, через команды `bd ready`, `bd list`, `bd create`, `bd update --claim`.

---

### #4. Mem0

**URL**: [github.com/mem0ai/mem0](https://github.com/mem0ai/mem0)
**Категория**: Память агентов
**Звёзды**: 51.1k | **Форки**: N/A
**Интеграция**: MCP server, Python/TypeScript SDK

**Что делает**: Универсальный слой памяти для AI-агентов. Гибридное хранилище, комбинирующее векторные БД (семантический поиск), графовые БД (моделирование связей) и key-value (быстрое извлечение фактов). Поддерживает user-level, session-level и agent-level скоупы памяти.

**Почему важен**: На бенчмарке LOCOMO показывает на 26% выше точность, чем память OpenAI. 91% ниже p95 latency и 90% экономия токенов по сравнению с full-context подходами. Нативно интегрирован в CrewAI, Flowise, Langflow. AWS выбрал Mem0 как эксклюзивного провайдера памяти для Agent SDK.

**Установка**:
```bash
pip install mem0ai
# MCP server
pip install mem0-mcp
```

---

### #5. Repomix

**URL**: [github.com/yamadashy/repomix](https://github.com/yamadashy/repomix)
**Категория**: Контекст / Упаковка кода
**Звёзды**: 22.4k
**Интеграция**: CLI, MCP server, GitHub Actions, Node.js library

**Что делает**: Упаковывает весь репозиторий в один AI-friendly файл (XML/Markdown/Plain text). Tree-sitter compression сокращает токены на ~70%, сохраняя структуру кода. Включает Secretlint для проверки безопасности.

**Почему важен**: Абсолютный лидер в категории context packing. Для репозиториев до 10k файлов Repomix -- оптимальный выбор перед переходом к RAG-решениям. XML-формат специально оптимизирован под XML-парсинг Claude. Поддерживает split-output для больших кодовых баз и skill-generate для извлечения навыков из open-source проектов.

**Установка**:
```bash
npx repomix
# глобально
npm install -g repomix
# MCP server
claude mcp add repomix -- npx -y repomix --mcp
```

**Уже в нашем стеке**: Да, через `repomix --output docs/context/codebase-snapshot.txt`.

---

### #6. Claude Code Action

**URL**: [github.com/anthropics/claude-code-action](https://github.com/anthropics/claude-code-action)
**Категория**: CI/CD
**Звёзды**: (часть claude-code, 81.6k)
**Интеграция**: GitHub Actions (v1)

**Что делает**: Официальный GitHub Action от Anthropic. Запускает Claude Code внутри CI/CD-пайплайна для автоматизации code review, PR-описаний, issue triage, генерации тестов, обновления документации и security-сканов. Поддерживает Tag Mode (@claude в PR/issue) и Agent Mode (headless автоматизация).

**Почему важен**: Замыкает цикл "агент пишет код -> CI проверяет -> агент исправляет". Стоимость для команды из 50 PR/месяц -- менее $5. Встроенные guardrails против runaway loops. Поддерживает Anthropic API, AWS Bedrock, Google Vertex AI, Microsoft Foundry.

**Установка**:
```bash
# В терминале Claude Code:
/install-github-app
# Или вручную в .github/workflows/:
# uses: anthropics/claude-code-action@v1
```

**Статус в нашем стеке**: Отсутствует. Рекомендуется к добавлению (приоритет 1).

---

### #7. Context7

**URL**: [github.com/upstash/context7](https://github.com/upstash/context7)
**Категория**: Контекст / Документация библиотек
**Звёзды**: 50.1k
**Интеграция**: MCP server

**Что делает**: MCP-сервер от Upstash, который подтягивает актуальную, версионно-специфичную документацию библиотек прямо в промпт агента. Решает проблему галлюцинаций об устаревших API.

**Почему важен**: Самый популярный MCP-сервер в экосистеме (50k+ звёзд). Два инструмента: resolve-library-id (определение библиотеки) и query-docs (извлечение документации).

**Предупреждения**: В январе 2026 бесплатный лимит урезан с 6000 до 1000 запросов/месяц (83% снижение). В феврале 2026 обнаружена уязвимость ContextCrush (инъекция через Custom Rules). Патч вышел за 2 дня, но архитектурный вопрос остаётся.

**Установка**:
```bash
claude mcp add context7 -- npx -y @upstash/context7-mcp@latest
```

**Рекомендация**: Рассмотреть замену на Docfork (MIT, без лимитов).

---

### #8. Docfork

**URL**: [github.com/docfork/docfork-mcp](https://github.com/docfork/docfork-mcp)
**Категория**: Контекст / Документация библиотек
**Звёзды**: ~2k
**Интеграция**: MCP server (remote)

**Что делает**: Open-source (MIT) альтернатива Context7 с поддержкой 9000+ библиотек. Уникальная функция "Cabinets" -- проектная изоляция контекста, привязывающая агента к проверенному стеку (например, Next.js + Better Auth) и предотвращающая загрязнение контекста нерелевантными библиотеками.

**Почему важен**: Один API-вызов на запрос (у Context7 -- два), что вдвое сокращает latency. AI-ранжирование результатов. Нет лимитов бесплатного тарифа. MIT-лицензия вместо проприетарной.

**Установка**:
```bash
claude mcp add docfork -- npx -y docfork-mcp@latest
```

---

### #9. GitHub Spec-Kit

**URL**: [github.com/github/spec-kit](https://github.com/github/spec-kit)
**Категория**: Design / Спецификации
**Звёзды**: 28k
**Интеграция**: CLI (specify), совместим с Claude Code, Gemini, Copilot, Cursor, Windsurf

**Что делает**: Официальный тулкит GitHub для Spec-Driven Development (SDD). Спецификация становится центром инженерного процесса: из неё генерируются чеклисты, разбивка на задачи и реализация. Четыре фазы: Specify, Plan, Tasks, Implement.

**Почему важен**: Стандартизирует подход, уже неформально используемый в нашем ai-config (spec-architect -> spec-developer -> spec-tester). Spec-Kit даёт формальный фреймворк с чекпоинтами между фазами. Поддерживает 10+ агентных CLI. Расширяем через плагины (cc-sdd добавляет quality gates и git worktree isolation).

**Установка**:
```bash
uvx --from git+https://github.com/github/spec-kit.git specify init <PROJECT_NAME>
```

---

### #10. Claude Agent SDK

**URL**: [github.com/anthropics/claude-agent-sdk-python](https://github.com/anthropics/claude-agent-sdk-python) | [npm: @anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
**Категория**: Оркестрация / SDK
**Звёзды**: N/A (официальный SDK Anthropic)
**Интеграция**: Python, TypeScript

**Что делает**: Программный доступ ко всем возможностям Claude Code: чтение файлов, выполнение команд, редактирование кода, вызов инструментов. Два entry point: `query()` для одноразовых задач и `ClaudeSDKClient` для сессий с сохранением контекста. Agent Teams -- координация нескольких агентов в параллельных сессиях.

**Почему важен**: Позволяет строить кастомные оркестраторы поверх Claude Code с полным контролем над lifecycle, tools, hooks. Нативная поддержка Agent Teams: lead agent создаёт teammates, координирует работу, обменивается сообщениями. Интегрируется с Microsoft Agent Framework для мульти-провайдерных workflow.

**Установка**:
```bash
# Python
pip install anthropic-agent-sdk
# TypeScript
npm install @anthropic-ai/claude-agent-sdk
```

---

### #11. Claude Context (Zilliz)

**URL**: [github.com/zilliztech/claude-context](https://github.com/zilliztech/claude-context)
**Категория**: RAG / Семантический поиск по коду
**Звёзды**: 5.2k | **Форки**: 462
**Интеграция**: MCP server/plugin

**Что делает**: MCP-сервер для семантического поиска по всей кодовой базе. AST-aware chunking через tree-sitter разбивает код по логическим границам (функции, классы, методы). Merkle tree обеспечивает инкрементальную переиндексацию только изменённых файлов. Гибридный поиск BM25 + dense vector.

**Почему важен**: Превращает Claude Code из "помощника, читающего файлы" в "помощника, понимающего кодовую базу". Для наших 64 агентов и сложной архитектуры -- критически важен. Замена линейного чтения файлов на семантический поиск.

**Установка**:
```bash
# Требует Zilliz Cloud API key и OpenAI API key
claude plugin install claude-context
# или
claude mcp add claude-context -- npx -y @anthropic-ai/claude-context
```

**Статус в нашем стеке**: Частично покрывается Qdrant MCP, но claude-context предлагает более продвинутый AST-chunking.

---

### #12. Qdrant

**URL**: [github.com/qdrant/qdrant](https://github.com/qdrant/qdrant) | MCP: [github.com/qdrant/mcp-server-qdrant](https://github.com/qdrant/mcp-server-qdrant)
**Категория**: RAG / Векторная БД
**Звёзды**: 29k (Qdrant) | MCP server отдельно
**Интеграция**: Docker, MCP server, REST API

**Что делает**: Высокопроизводительная векторная БД на Rust. Квантизация снижает потребление RAM на 97%. Поддерживает dense и sparse vectors. Горизонтальное масштабирование через шардинг и репликацию. Используется Canva, HubSpot, Roche, Bosch.

**Почему важен**: Ядро RAG-инфраструктуры нашего стека. Последняя версия v1.17.1 (март 2026). Получил $50M в раунде B (всего $87.5M). Официальный MCP-сервер предоставляет инструменты `qdrant-store` и `qdrant-find`.

**Установка**:
```bash
# Docker (уже в нашем стеке)
docker pull qdrant/qdrant:latest
docker run -p 6333:6333 qdrant/qdrant

# MCP server
uvx mcp-server-qdrant --qdrant-url http://localhost:6333 --collection claude-memory
```

**Уже в нашем стеке**: Да, через `roles/ai/` Ansible role и `setup-ai.sh`.

---

### #13. Figma MCP

**URL**: [Figma MCP Server Guide](https://help.figma.com/hc/en-us/articles/32132100833559)
**Категория**: Дизайн
**Звёзды**: N/A (official Figma)
**Интеграция**: MCP server (remote), Claude Code Plugin

**Что делает**: Двусторонняя интеграция Claude Code с Figma. Code-to-Design: создание и модификация нативного Figma-контента из кода. Design-to-Code: извлечение переменных, компонентов и layout-данных в IDE. Live UI Capture: перенос live UI (production/staging/localhost) в Figma как редактируемых слоёв.

**Почему важен**: Замыкает цикл "дизайн-код-дизайн" для мультиагентных систем. Агент-дизайнер может читать дизайн-систему и применять её при генерации UI. Бесплатно во время бета-периода.

**Установка**:
```bash
# Рекомендуемый способ (плагин):
claude plugin install figma@claude-plugins-official
# Или напрямую:
claude mcp add --transport http figma https://mcp.figma.com/mcp
```

---

### #14. OpenPencil

**URL**: [github.com/open-pencil/open-pencil](https://github.com/open-pencil/open-pencil) | [openpencil.dev](https://openpencil.dev)
**Категория**: Дизайн
**Звёзды**: 3.0k (за 1 месяц с момента запуска)
**Интеграция**: MCP server (87 core + 3 file management tools)

**Что делает**: Open-source, AI-native дизайн-редактор и альтернатива Figma. Читает .fig файлы нативно, каждая операция скриптабельна. Real-time совместное редактирование через WebRTC (без сервера). Auto layout и CSS Grid через Yoga WASM, экспорт в Tailwind CSS.

**Почему важен**: Появился после того, как Figma отключила `--remote-debugging-port` в феврале 2026, убив сторонние автоматизации. MIT-лицензия, данные не покидают машину. MCP-сервер с 87 инструментами позволяет агентам создавать фигуры, управлять auto-layout, работать с компонентами и переменными, экспортировать ассеты.

**Установка**:
```bash
# Desktop (Tauri, ~7 MB)
# Скачать с openpencil.dev
# MCP server для Claude Code:
claude mcp add openpencil -- npx -y @openpencil/mcp-server
```

---

### #15. Tree-sitter MCP Server

**URL**: [github.com/wrale/mcp-server-tree-sitter](https://github.com/wrale/mcp-server-tree-sitter)
**Категория**: Анализ кода / AST
**Звёзды**: ~1.5k
**Интеграция**: MCP server

**Что делает**: MCP-сервер, предоставляющий AI-агентам структурный анализ кода через Abstract Syntax Trees. Инструменты: get_ast, get_symbols, get_dependencies, analyze_complexity, find_usage, run_query (S-expression queries). Поддерживает мультиязычный анализ.

**Почему важен**: Переводит взаимодействие агента с кодом от "чтения текста файлов" к "пониманию структуры кода". Агент может спросить "какие аргументы у этой функции?" или "найди все классы, наследующиеся от этого базового класса". Используется в Cline (трёхуровневая система retrieval) и Aider (repo-map через AST с PageRank ранжированием).

**Установка**:
```bash
claude mcp add tree-sitter -- npx -y @anthropic-ai/mcp-server-tree-sitter
# или Python-версия:
pip install mcp-server-tree-sitter
```

---

### #16. Sequential Thinking MCP

**URL**: [github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking](https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking)
**Категория**: Рассуждения / Мета-инструмент
**Звёзды**: Часть официального MCP servers repo
**Интеграция**: MCP server

**Что делает**: Мета-инструмент для структурированного пошагового рассуждения. В отличие от internal chain-of-thought, экстернализирует процесс мышления: поддерживает ветвление (branching), ревизию (revision) и динамическую корректировку. Позволяет агенту "думать вслух" в структурированном формате.

**Почему важен**: Кодифицирует "сеньорность" в runtime агента. Вместо немедленного написания кода агент сначала анализирует проблему, предсказывает побочные эффекты (какие frontend-компоненты сломаются при миграции БД), создаёт "Repair List". Особенно полезен для spec-architect и team-lead в нашей системе.

**Установка**:
```bash
claude mcp add sequential-thinking -s local -- npx -y @modelcontextprotocol/server-sequential-thinking
```

---

### #17. claude-code-templates (davila7)

**URL**: [github.com/davila7/claude-code-templates](https://github.com/davila7/claude-code-templates) | [aitmpl.com](https://aitmpl.com)
**Категория**: Шаблоны / Коллекция агентов
**Звёзды**: 23.3k | **Форки**: 2.2k
**Интеграция**: CLI (npx), веб-интерфейс

**Что делает**: Крупнейшая коллекция готовых конфигураций для Claude Code: 600+ агентов, 200+ команд, 55+ MCP-конфигов, 60+ настроек, 39+ хуков, 14+ шаблонов проектов. Веб-интерфейс на aitmpl.com для browse и установки.

**Почему важен**: Референсная база для дизайна агентов и MCP-интеграций. Полезен для бенчмаркинга наших 64 агентов против 600+ альтернатив. Security validation system обеспечивает качество и безопасность компонентов. Поддерживает skills (из официального Anthropic skills repo).

**Установка**:
```bash
# Полный стек
npx claude-code-templates@latest --agent development-team/frontend-developer \
  --command testing/generate-tests \
  --mcp development/github-integration --yes

# Отдельный агент
npx claude-code-templates@latest --agent=development-team/frontend-developer
```

---

### #18. wshobson/agents

**URL**: [github.com/wshobson/agents](https://github.com/wshobson/agents)
**Категория**: Плагины / Оценка качества
**Звёзды**: ~1k
**Интеграция**: Claude Code Plugin (.claude-plugin)

**Что делает**: 99 специализированных агентов, 107 навыков, 71 инструмент, организованных в 67 focused плагинов. Уникальная система оценки качества агентов: 3 уровня (статический анализ, LLM-judge, Monte Carlo симуляция), 10 измерений качества, badge-система (Platinum/Gold/Silver/Bronze), anti-pattern detection.

**Почему важен**: Единственная в экосистеме система формальной оценки и сертификации агентов. CI Gate с `--threshold` для автоматической блокировки ниже минимального балла. Подход к трёхуровневой модельной маршрутизации (Opus/Sonnet/Haiku) совпадает с нашей архитектурой. Progressive disclosure экономит контекст.

**Установка**:
```bash
# Установка конкретного плагина
claude plugin install wshobson/agents/plugins/<plugin-name>

# Оценка
uv run plugin-eval score <plugin-path>
uv run plugin-eval certify <plugin-path>
```

---

### #19. Claude-Code-Workflow (catlog22)

**URL**: [github.com/catlog22/Claude-Code-Workflow](https://github.com/catlog22/Claude-Code-Workflow)
**Категория**: Воркфлоу-движок
**Звёзды**: 1.5k
**Интеграция**: CLI (/ccw), MCP server, npm (@dyw/claude-code-workflow)

**Что делает**: JSON-driven фреймворк для мультиагентной cadence-team разработки. Принцип "ONE AGENT = ONE TASK JSON". 37 модульных навыков (workflow-plan, TDD, brainstorm, team coordination). ACE (Augment Context Engine) для семантического поиска. React-фронтенд с Terminal Dashboard.

**Почему важен**: Реализует подход "workflow как данные" (JSON), что делает процесс воспроизводимым и version-controlled. Автоматический workflow-execute выполняет весь pipeline без прерывания, используя TodoWrite для трекинга прогресса. Поддерживает мульти-CLI оркестрацию (Gemini, Qwen, Codex).

**Установка**:
```bash
npm install -g @dyw/claude-code-workflow
# или в Claude Code:
/ccw
```

---

### #20. Sourcegraph Cody

**URL**: [sourcegraph.com/cody](https://sourcegraph.com/cody)
**Категория**: Поиск по коду / AI-ассистент
**Звёзды**: N/A (коммерческий продукт)
**Интеграция**: VS Code, JetBrains, Visual Studio, веб-интерфейс

**Что делает**: AI-ассистент кодирования, построенный на RAG-архитектуре Sourcegraph: pre-indexed vector embeddings + advanced code-search. Понимает всю мультирепозиторную кодовую базу организации. Мульти-LLM: Claude, Gemini, GPT. Self-hosted и air-gapped deployment для enterprise.

**Почему важен**: Для крупных организаций с сотнями репозиториев Cody обеспечивает codebase-scale intelligence, недоступный другим инструментам. Gartner Magic Quadrant 2025: Visionary. Заявленная экономия: 5-6 часов/неделю на инженера, скорость написания кода 2x.

**Установка**:
```bash
# VS Code Extension
code --install-extension sourcegraph.cody-ai
# Enterprise: self-hosted Sourcegraph instance
```

**Цена**: Free tier, Pro, Enterprise ($59/user/month включая Sourcegraph platform).

---

## 4. Карта интеграций: как инструменты работают вместе

```
                    +-------------------+
                    |   ОРКЕСТРАЦИЯ     |
                    |                   |
                    |  Claude Agent SDK |
                    |  Ruflo / GasTown  |
                    +--------+----------+
                             |
              +--------------+--------------+
              |              |              |
    +---------v---+  +-------v------+  +----v-----------+
    | КОНТЕКСТ    |  |    ПАМЯТЬ    |  |   WORKFLOW      |
    |             |  |              |  |                 |
    | Repomix     |  | Beads (bd)   |  | Spec-Kit        |
    | Context7    |  | Mem0         |  | CC-Workflow     |
    | Docfork     |  | Memory Bank  |  | CC-Templates    |
    +------+------+  +------+-------+  +--------+-------+
           |                |                    |
    +------v------+  +------v-------+   +--------v------+
    |    RAG      |  |   АНАЛИЗ     |   |    CI/CD      |
    |             |  |    КОДА      |   |               |
    | Qdrant      |  | Tree-sitter  |   | Claude Code   |
    | Claude      |  |   MCP        |   |   Action      |
    |  Context    |  | Sequential   |   | GitHub Actions|
    +------+------+  |  Thinking    |   +--------+------+
           |         +------+-------+            |
           |                |                    |
    +------v----------------v--------------------v------+
    |                    ДИЗАЙН                         |
    |                                                    |
    |     Figma MCP     |    OpenPencil    |   Cody      |
    +----------------------------------------------------+
```

### Типичный pipeline мультиагентной разработки:

```
1. ИНИЦИАЦИЯ
   Spec-Kit (specify) --> спецификация --> plan --> tasks

2. КОНТЕКСТ
   Repomix (snapshot) + Claude Context (семантический поиск)
   + Context7/Docfork (документация библиотек)

3. ОРКЕСТРАЦИЯ
   team-lead (Claude Agent SDK) --> spawn специализированных агентов
   Beads (bd) --> управление задачами между агентами

4. РЕАЛИЗАЦИЯ
   spec-developer агенты --> код
   Tree-sitter MCP --> структурный анализ
   Sequential Thinking --> архитектурные решения

5. ДИЗАЙН
   Figma MCP / OpenPencil --> design-to-code / code-to-design

6. ВЕРИФИКАЦИЯ
   spec-tester --> тесты
   wshobson/agents eval --> оценка качества

7. CI/CD
   Claude Code Action --> автоматический code review
   --> автоматические исправления по @claude

8. ПЕРСИСТЕНЦИЯ
   Mem0 --> долгосрочная память
   Beads compaction --> сжатие завершённых задач
   Memory Bank (centminmod) --> контекстные файлы
```

---

## 5. Рекомендации для нашего ai-config стека

### Приоритет 1: Немедленное внедрение

| Инструмент | Действие | Обоснование |
|-----------|---------|-------------|
| **Claude Code Action** | Добавить `.github/workflows/claude-review.yml` | Автоматический code review, issue-to-PR. Стоимость < $5/мес. |
| **Docfork** | Заменить Context7 в MCP-конфиге | MIT, без лимитов, 1 API-вызов вместо 2, Cabinets для изоляции |
| **Sequential Thinking MCP** | Добавить в `.claude/settings.json` | Критично для spec-architect и team-lead агентов |

### Приоритет 2: Краткосрочное внедрение (1-2 недели)

| Инструмент | Действие | Обоснование |
|-----------|---------|-------------|
| **Claude Context (Zilliz)** | Добавить как дополнение к Qdrant MCP | AST-aware chunking + Merkle tree >> наивная индексация |
| **Memory Bank pattern** | Разделить CLAUDE.md на CLAUDE-*.md файлы | Паттерн centminmod: activeContext, patterns, decisions, troubleshooting |
| **GitHub Spec-Kit** | Интегрировать `specify` в workflow templates | Формализация нашего spec-driven подхода по стандарту GitHub |

### Приоритет 3: Среднесрочное исследование (1-2 месяца)

| Инструмент | Действие | Обоснование |
|-----------|---------|-------------|
| **Beads** | Уже используется; добавить Beads Viewer для визуализации | Kanban, dependency DAG, PageRank, critical path |
| **Ruflo** | Оценить SONA routing для нашей модельной маршрутизации | 3-tier routing (WASM/Haiku/Opus) может значительно сократить расходы |
| **wshobson eval system** | Адаптировать для оценки наших 64 агентов | 10 измерений + badge + CI gate |
| **Mem0** | Оценить как замену Memory Bank | Hybrid store (vector + graph + KV) vs наши MD-файлы |

### Приоритет 4: Стратегическое направление

| Инструмент | Действие | Обоснование |
|-----------|---------|-------------|
| **OpenPencil** | Мониторить развитие, добавить при стабилизации | MIT альтернатива Figma MCP, 87 MCP tools, local-first |
| **Claude Agent SDK** | Рефакторить Constitution.md под Agent Teams | Нативная координация > наша кастомная оркестрация |
| **Gas Town** | Экспериментальное использование | $100/час -- пока дорого, но архитектура (Mayor/Polecats/MEOW) перспективна |

### Конфигурация MCP-серверов (рекомендуемый .mcp.json)

```json
{
  "mcpServers": {
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
    },
    "docfork": {
      "command": "npx",
      "args": ["-y", "docfork-mcp@latest"]
    },
    "repomix": {
      "command": "npx",
      "args": ["-y", "repomix", "--mcp"]
    },
    "qdrant": {
      "command": "uvx",
      "args": ["mcp-server-qdrant"],
      "env": {
        "QDRANT_URL": "http://localhost:6333",
        "COLLECTION_NAME": "ai-config-memory"
      }
    },
    "claude-context": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/claude-context"],
      "env": {
        "ZILLIZ_CLOUD_URI": "${ZILLIZ_CLOUD_URI}",
        "ZILLIZ_CLOUD_TOKEN": "${ZILLIZ_CLOUD_TOKEN}"
      }
    },
    "tree-sitter": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-server-tree-sitter"]
    }
  }
}
```

---

## Источники

| # | Источник | Тип | Дата | Релевантность |
|---|--------|------|------|-----------|
| 1 | [Ruflo (ruvnet/ruflo)](https://github.com/ruvnet/ruflo) | GitHub | 2026-02 | High |
| 2 | [Gas Town (steveyegge/gastown)](https://github.com/steveyegge/gastown) | GitHub | 2026-01 | High |
| 3 | [Beads (steveyegge/beads)](https://github.com/steveyegge/beads) | GitHub | 2026-03 | High |
| 4 | [Mem0 (mem0ai/mem0)](https://github.com/mem0ai/mem0) | GitHub | 2026-03 | High |
| 5 | [Repomix (yamadashy/repomix)](https://github.com/yamadashy/repomix) | GitHub | 2026-03 | High |
| 6 | [Claude Code Action (anthropics/claude-code-action)](https://github.com/anthropics/claude-code-action) | GitHub | 2026-03 | High |
| 7 | [Context7 (upstash/context7)](https://github.com/upstash/context7) | GitHub | 2026-03 | High |
| 8 | [Docfork MCP](https://github.com/docfork/docfork-mcp) | GitHub | 2026-02 | High |
| 9 | [GitHub Spec-Kit (github/spec-kit)](https://github.com/github/spec-kit) | GitHub | 2026-03 | High |
| 10 | [Claude Agent SDK (Python)](https://github.com/anthropics/claude-agent-sdk-python) | GitHub | 2026-03 | High |
| 11 | [Claude Context (zilliztech/claude-context)](https://github.com/zilliztech/claude-context) | GitHub | 2026-03 | High |
| 12 | [Qdrant (qdrant/qdrant)](https://github.com/qdrant/qdrant) | GitHub | 2026-03 | High |
| 13 | [Figma MCP Server Guide](https://help.figma.com/hc/en-us/articles/32132100833559) | Docs | 2026-02 | High |
| 14 | [OpenPencil (open-pencil/open-pencil)](https://github.com/open-pencil/open-pencil) | GitHub | 2026-03 | Medium |
| 15 | [Tree-sitter MCP Server](https://github.com/wrale/mcp-server-tree-sitter) | GitHub | 2026-02 | Medium |
| 16 | [Sequential Thinking MCP](https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking) | GitHub | 2026-01 | Medium |
| 17 | [claude-code-templates (davila7)](https://github.com/davila7/claude-code-templates) | GitHub | 2026-03 | High |
| 18 | [wshobson/agents](https://github.com/wshobson/agents) | GitHub | 2026-02 | Medium |
| 19 | [Claude-Code-Workflow (catlog22)](https://github.com/catlog22/Claude-Code-Workflow) | GitHub | 2026-03 | Medium |
| 20 | [Sourcegraph Cody](https://sourcegraph.com/cody) | Product | 2026-03 | Medium |
| 21 | [centminmod/my-claude-code-setup](https://github.com/centminmod/my-claude-code-setup) | GitHub | 2026-03 | Medium |
| 22 | [erik-opg/claude-setup](https://github.com/erik-opg/claude-setup) | GitHub | 2026-02 | Medium |
| 23 | [Qdrant MCP Server (official)](https://github.com/qdrant/mcp-server-qdrant) | GitHub | 2026-03 | High |
| 24 | [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25) | Docs | 2025-11 | High |
| 25 | [Top 7 MCP Alternatives for Context7](https://dev.to/moshe_io/top-7-mcp-alternatives-for-context7-in-2026-2555) | Article | 2026-02 | Medium |
| 26 | [Beads: AI Agent Memory System](https://www.decisioncrafters.com/beads-ai-agent-memory-system/) | Article | 2026-03 | Medium |
| 27 | [Cursor vs Windsurf vs Claude Code 2026](https://dev.to/pockit_tools/cursor-vs-windsurf-vs-claude-code-in-2026-the-honest-comparison-after-using-all-three-3gof) | Article | 2026-03 | Medium |
| 28 | [AI Agent Memory Systems in 2026](https://yogeshyadav.medium.com/ai-agent-memory-systems-in-2026-mem0-zep-hindsight-memvid-and-everything-in-between-compared-96e35b818da8) | Article | 2026-03 | Medium |
| 29 | [cAST: AST Chunking for Code RAG](https://arxiv.org/abs/2506.15655) | Paper | 2025-06 | Medium |
| 30 | [Claude Code GitHub Actions Docs](https://code.claude.com/docs/en/github-actions) | Docs | 2026-03 | High |
