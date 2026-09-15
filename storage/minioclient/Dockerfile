FROM quay.io/minio/mc:RELEASE.2024-11-21T17-21-54Z

COPY entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

# ENTRYPOINT [ "/entrypoint.sh" ]
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]