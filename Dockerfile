# Dockerfile
FROM nginx:alpine

# Optional workdir
WORKDIR /usr/share/nginx/html

# Copy site files (adjust paths if your HTML files live in a subfolder)
COPY start.html            /usr/share/nginx/html/index.html
COPY start.html            /usr/share/nginx/html/start.html
COPY rednode.html          /usr/share/nginx/html/rednode.html
COPY dashboard1.html       /usr/share/nginx/html/dashboard1.html
COPY dashboard.html        /usr/share/nginx/html/dashboard.html
COPY home.html             /usr/share/nginx/html/home.html
COPY sensor2.html          /usr/share/nginx/html/sensor2.html

COPY live/                 /usr/share/nginx/html/live/
COPY static/               /usr/share/nginx/html/static/

# Put an nginx config template that listens on port 80 (we'll replace 80 with $PORT at runtime)
COPY nginx.conf.template   /etc/nginx/conf.d/default.conf.template

# Expose is only documentation; Render provides PORT via env
EXPOSE 80

# At runtime replace "listen 80;" with "listen ${PORT};" then start nginx in foreground
CMD ["sh", "-c", "sed -e \"s/listen 80;/listen ${PORT};/g\" /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
