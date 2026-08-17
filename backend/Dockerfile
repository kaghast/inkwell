WORKDIR /app

# Derleme için gerekli sistem paketlerini yükleyin
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    python3-dev \
    libffi-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./

# Paketleri kurun
RUN pip install --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY . .
