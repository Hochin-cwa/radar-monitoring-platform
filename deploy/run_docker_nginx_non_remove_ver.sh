# 1. 修正名稱為 nginx2，並維持對應 Port 3002
podman run -d --name nginx3 --add-host=host.docker.internal:host-gateway -p 3003:80 -v /data/com298/radar-monitoring-platform/frontend:/usr/share/nginx/html:z --restart=always nginx

# 2. 確保複製與執行對象都是新容器 nginx2
podman cp /data/com298/radar-monitoring-platform-3003/deploy/nginx.conf nginx3:/etc/nginx/conf.d/default.conf
podman exec nginx3 nginx -t && podman exec nginx3 nginx -s reload
