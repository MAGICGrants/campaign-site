#!/bin/sh
set -eux
: "${NGINX_SERVER_NAME:=localhost}"
sed "s#\${NGINX_SERVER_NAME}#${NGINX_SERVER_NAME}#g" /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf
nginx -t
exec nginx -g 'daemon off;'
