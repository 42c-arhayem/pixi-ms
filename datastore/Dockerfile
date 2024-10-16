FROM --platform=linux/amd64 amd64/mongo:4.4.23

ADD  ./Pixi44Dump.tar /tmp
COPY pixi_restore.sh /docker-entrypoint-initdb.d
RUN chmod +x /docker-entrypoint-initdb.d/pixi_restore.sh
# Expose port 27017 from the container to the host
EXPOSE 27017

# Set usr/bin/mongod as the dockerized entry-point application
#CMD ["mongod","--quiet", "--bind_ip_all", "--replSet", "order"]
