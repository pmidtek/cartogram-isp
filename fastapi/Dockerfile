FROM ghcr.io/osgeo/gdal:ubuntu-full-3.8.5

# Install Poetry
ENV POETRY_HOME=/opt/poetry \
    POETRY_NO_INTERACTION=1 \
    POETRY_VIRTUALENVS_CREATE=0 \
    POETRY_CACHE_DIR=/tmp/poetry_cache
RUN wget -O - https://install.python-poetry.org | python3 - --version 1.6.1
ENV PATH=$POETRY_HOME/bin:$PATH

WORKDIR /app

# Copy pyproject first to leverage Docker layer caching
COPY pyproject.toml ./

# Generate a new lock file and install dependencies
RUN poetry lock --no-update \
    && pip install --no-use-pep517 gdal==3.8.4 \
    && poetry install --no-root \
    && rm -rf $POETRY_CACHE_DIR

# Now copy the actual source code
COPY . .

# Run FastAPI app
CMD ["poetry", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
