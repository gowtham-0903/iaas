FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    default-libmysqlclient-dev \
    build-essential \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir gunicorn

COPY . .

RUN mkdir -p uploads/jd_files uploads/resumes

EXPOSE 5000

CMD ["sh", "-c", "flask db upgrade && gunicorn --bind 0.0.0.0:5000 --workers 4 --threads 2 --timeout 120 wsgi:app"]
