# Use Nginx to serve the RedNode HTML page
FROM nginx:alpine

# Copy the landing page and static assets to the container's web root
COPY home.html /usr/share/nginx/html/index.html
COPY home.html /usr/share/nginx/html/home.html
COPY rednode.html /usr/share/nginx/html/rednode.html
COPY live/ /usr/share/nginx/html/live/
COPY static/ /usr/share/nginx/html/static/

# Expose default Nginx port
EXPOSE 80

# Use the default Nginx start command
CMD ["nginx", "-g", "daemon off;"]
