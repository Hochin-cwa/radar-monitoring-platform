if docker container ls|grep nginx|awk '{print $1}' ;then
   docker rm -f $( docker container ls|grep nginx|awk '{print $1}')
   sleep 3
fi
docker run -d --name nginx  --add-host=host.docker.internal:host-gateway -p 3001:80 -v /data/b615/radar-monitoring-platform/frontend:/usr/share/nginx/html:z --restart=always nginx
docker cp /data/b615/radar-monitoring-platform/deploy/nginx.conf nginx:/etc/nginx/conf.d/default.conf
docker exec nginx nginx -t && docker exec nginx nginx -s reload
