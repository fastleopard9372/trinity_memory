// README.md

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

```
User Query → Express API → Auth Check → Query Parser
                ↓
         [Semantic/Structured]
                ↓
    Pinecone/PostgreSQL (file paths)
                ↓
         NAS File Reader
                ↓
         Return Content
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
