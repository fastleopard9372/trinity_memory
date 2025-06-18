# Trinity AI

A self-managing AI agent with dual memory system combining fast vector search and persistent NAS storage.

## Features

- 🧠 **Dual Memory System**: Combines Pinecone vector search with PostgreSQL metadata
- 💾 **NAS Integration**: All content stored on your private NAS
- 🔍 **Intelligent Search**: Natural language queries with semantic understanding
- 🤖 **Agent Automation**: Automated proposal generation and job monitoring
- 🔐 **Multi-user Support**: Secure, isolated environments per user
- 📊 **Analytics**: Track usage, search patterns, and memory insights

## Tech Stack

- **Backend**: Node.js, Express, TypeScript
- **Database**: PostgreSQL (via Supabase), Prisma ORM
- **Vector Search**: Pinecone
- **File Storage**: NAS (WebDAV/SMB/rclone)
- **AI**: OpenAI, LangChain
- **Auth**: Supabase Auth
- **Automation**: n8n workflows

## Project Scope for Phase 1 – Final Spec (You Can Send This to Volo)

### Project: Trinity AI – Phase 1 (Memory + Message Handling MVP)

**Goal**: Build a self-contained memory system and basic input/output agent that can:

- Receive natural language messages
- Parse and structure memory from them
- Store memory entries
- Query past memories
- Respond with summaries

### Modules

1. **Input Listener** (can be CLI or simple HTTP endpoint)
    - Accepts raw text input
    - Triggers memory parser

2. **Memory Parser**
    - Extract from text:
      - date (from text or default to today)
      - people (names)
      - topics (noun phrases)
      - actions (sentences with verbs + "I"/"we")
      - tags (nouns + named entities)
    - Output: structured JSON

3. **Memory Saver**
    - Save structured JSON to local filesystem (or NAS path)
    - Format: .json file per memory or append to a .log.json file
    - Folder: /memory/logs/yyyy-mm/ etc.

4. **Query Handler**
    - Accept query like: “What did I say about health last week?”
    - Search memory entries (by keyword, tag, or date range)
    - Return matching structured entries or summarized output

5. **Summarizer Agent**
    - For longer entries: auto-generate a summary and store it alongside raw data
    - Use basic prompt → send to OpenAI if needed (optional for now)

### Testing
- Include 2–3 sample memory entries and 1 example query
- Make sure query handler can retrieve them and respond cleanly
- Keep all configs modular and paths readable

### Notes
- No more code from me or ChatGPT.
- You fully own all code — clean, professional, modular.
- I will not change these specs once you begin.
- Once Phase 1 is done, we’ll have a clean platform to test and build on.

You can paste that whole message into ClickUp or send it to him directly with a note like:

> “Here’s the final scope for Phase 1 — no more changes. Please ignore the GPT code from before and work from this document only. Thanks for your patience.”

---

## Quick Start

1. **Clone the repository**

    ```bash
    git clone https://github.com/yourusername/trinity-ai.git
    cd trinity-ai
    ```

2. **Install dependencies**

    ```bash
    npm install
    ```

3. **Configure environment**

    ```bash
    cp .env.example .env
    # Edit .env with your configuration
    ```

4. **Setup database**

    ```bash
    npm run prisma:migrate
    npm run prisma:seed
    ```

5. **Start development server**
    ```bash
    npm run dev
    ```

## API Endpoints

### Authentication

- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `POST /api/auth/refresh` - Refresh token
- `GET /api/auth/profile` - Get user profile

### Memory Management

- `POST /api/memory/conversations` - Save conversation
- `GET /api/memory/conversations` - List conversations
- `GET /api/memory/conversations/:id` - Get conversation
- `POST /api/memory/conversations/:id/summary` - Generate summary

### Search

- `GET /api/search?q=query` - Search memories
- `POST /api/search/file` - Get file by path

### File Management

- `POST /api/files/upload` - Upload file
- `GET /api/files/list` - List files
- `POST /api/files/reindex` - Re-index file

### Agent Functions

- `GET /api/agent/jobs` - List jobs
- `POST /api/agent/jobs` - Create job
- `POST /api/agent/proposals` - Generate proposal

## Architecture