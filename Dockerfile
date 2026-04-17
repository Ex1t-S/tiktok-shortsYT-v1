FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

RUN sed -i 's|http://archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g; s|http://security.ubuntu.com/ubuntu|https://security.ubuntu.com/ubuntu|g' /etc/apt/sources.list.d/ubuntu.sources \
  && apt-get -o Acquire::Retries=5 -o Acquire::ForceIPv4=true update \
  && apt-get install -y --fix-missing --no-install-recommends python3-pip \
  && python3 -m pip install --break-system-packages --no-cache-dir yt-dlp \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV YT_DLP_PATH=yt-dlp

CMD ["npm", "start"]
