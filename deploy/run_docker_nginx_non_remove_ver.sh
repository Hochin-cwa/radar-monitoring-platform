# 1. 修正名稱為 nginx2，並維持對應 Port 3002
podman run -d --name nginx2 --add-host=host.docker.internal:host-gateway -p 3002:80 -v /data/com298/radar-monitoring-platform/frontend:/usr/share/nginx/html:z --restart=always nginx

# 2. 確保複製與執行對象都是新容器 nginx2
podman cp /data/com298/radar-monitoring-platform/deploy/nginx.conf nginx2:/etc/nginx/conf.d/default.conf
podman exec nginx2 nginx -t && podman exec nginx2 nginx -s reload
