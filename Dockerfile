FROM nginx:latest
COPY console.html /usr/share/nginx/html/console/console.html
COPY console_lite.html /usr/share/nginx/html/console/console_lite.html
COPY core /usr/share/nginx/html/console/core
COPY app /usr/share/nginx/html/console/app
COPY vendor /usr/share/nginx/html/console/vendor