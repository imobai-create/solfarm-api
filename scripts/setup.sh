#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════╗"
echo "║        🌿 HubFarm — Setup Inicial            ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# 1. Verifica se Docker está rodando
echo -e "${YELLOW}[1/5] Verificando Docker...${NC}"
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker não está rodando. Inicie o Docker Desktop e tente novamente."
  exit 1
fi
echo "✅ Docker OK"

# 2. Sobe o banco de dados
echo -e "${YELLOW}[2/5] Iniciando PostgreSQL + PostGIS...${NC}"
docker-compose up -d
echo "✅ Banco de dados iniciado"

# 3. Aguarda o banco estar pronto
echo -e "${YELLOW}[3/5] Aguardando banco de dados...${NC}"
for i in {1..10}; do
  if docker exec hubfarm_postgres pg_isready -U hubfarm -d hubfarm_db > /dev/null 2>&1; then
    echo "✅ PostgreSQL pronto!"
    break
  fi
  echo "   Aguardando... ($i/10)"
  sleep 2
done

# 4. Aplica o schema
echo -e "${YELLOW}[4/5] Aplicando schema do banco...${NC}"
npx prisma db push --accept-data-loss
echo "✅ Schema aplicado"

# 5. Popula com dados de teste
echo -e "${YELLOW}[5/5] Populando dados iniciais...${NC}"
npx tsx prisma/seed.ts
echo "✅ Seed concluído"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗"
echo "║        ✅ Setup concluído com sucesso!        ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  Para iniciar:   npm run dev                 ║"
echo "║  API:            http://localhost:3333        ║"
echo "║  Docs (Swagger): http://localhost:3333/docs   ║"
echo "║  DB Studio:      npm run db:studio            ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"
