# Imagem oficial Node.js 24 Alpine leve e segura
FROM node:24-alpine

WORKDIR /app

# Copia arquivos do projeto
COPY package*.json ./
COPY . .

# Expõe a porta do sistema
ENV PORT=3000
ENV AUTO_OPEN=false
EXPOSE 3000

# Inicia a aplicação com persistência SQLite
CMD ["node", "server.js"]
