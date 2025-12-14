# Use nginx
FROM nginx:alpine

WORKDIR /usr/share/nginx/html

# copy site files
COPY start.html            /usr/share/nginx/html/index.html
COPY start.html            /usr/share/nginx/html/start.html
COPY rednode.html          /usr/share/nginx/html/rednode.html
COPY dashboard1.html       /usr/share/nginx/html/dashboard1.html
COPY dashboard.html        /usr/share/nginx/html/dashboard.html
COPY home.html             /usr/share/nginx/html/home.html
COPY sensor2.html          /usr/share/nginx/html/sensor2.html

COPY live/                 /usr/share/nginx/html/live/
COPY static/               /usr/share/nginx/html/static/

# Create nginx config template at build-time
RUN cat > /etc/nginx/conf.d/default.conf.template <<'EOF'
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(?:css|js|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot)$ {
        expires 7d;
        add_header Cache-Control "public";
    }

    location /live/ {
        try_files $uri $uri/ /index.html;
    }
}
EOF

# Expose documentation only; Render provides actual PORT via env
EXPOSE 80

# Replace "listen 80;" with "listen ${PORT};" at container start, then run nginx
CMD ["sh", "-c", "sed -e \"s/listen 80;/listen ${PORT};/g\" /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
