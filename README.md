# Promptly (Team Alpha, CBC015)

## Run locally
1. PostgreSQL running locally (or Docker):
   docker run -d --name promptly-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=promptly -p 5432:5432 postgres:16
2. Backend
   cd backend
   cp .env.example .env
   npm install
   npx prisma db push      # creates tables from prisma/schema.prisma
   npm run dev             # http://localhost:4000/api/health
3. Frontend (second terminal)
   cd frontend
   cp .env.example .env
   npm install
   npm run dev             # http://localhost:5173
