# Base de conhecimento pessoal — Node puro, sem npm install e sem build.
# Só entra na imagem o que roda: servidor/ e site/ (nada de .git nem mcp/).
FROM node:24-alpine
WORKDIR /app
COPY servidor/ ./servidor/
COPY site/     ./site/
RUN mkdir -p /dados && chown -R node:node /dados /app
USER node
ENV PORTA=3000 PASTA_SITE=/app/site PASTA_DADOS=/dados NODE_ENV=production
EXPOSE 3000
VOLUME ["/dados"]
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/estado').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "servidor/servidor.js"]
