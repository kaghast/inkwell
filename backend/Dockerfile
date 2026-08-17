FROM python:3.11-slim

WORKDIR /app

# jq ve C eklentilerinin derlenebilmesi için gerekli sistem kütüphaneleri
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    python3-dev \
    libffi-dev \
    libonig-dev \
    libtool \
    automake \
    autoconf \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./

RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
