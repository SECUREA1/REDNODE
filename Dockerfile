# Use Nginx to serve the RedNode HTML pages
FROM nginx:alpine

# Set working dir (optional, helps readability)
WORKDIR /usr/share/nginx/html

# Ensure the landing/start page is available as index.html
# and copy the main HTML pages we serve.
COPY start.html            /usr/share/nginx/html/index.html
COPY start.html            /usr/share/nginx/html/start.html
COPY rednode.html          /usr/share/nginx/html/rednode.html

# <-- Important: copy the dashboard and related pages so nginx can serve them -->
COPY dashboard1.html       /usr/share/nginx/html/dashboard1.html
COPY dashboard.html        /usr/share/nginx/html/dashboard.html
COPY home.html             /usr/share/nginx/html/home.html

# Copy other site assets and the live folder
COPY live/                 /usr/share/nginx/html/live/
COPY static/               /usr/share/nginx/html/static/

# Expose Nginx default HTTP port
EXPOSE 80

# Run nginx in foreground
CMD ["nginx", "-g", "daemon off;"]
