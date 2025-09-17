# Use Nginx to serve the RedNode HTML page
FROM nginx:alpine

# Copy the main client HTML and static assets to the container's web root
COPY index.html /usr/share/nginx/html/index.html
COPY static/ /usr/share/nginx/html/static/

# Expose default Nginx port
EXPOSE 80

# Use the default Nginx start command
CMD ["nginx", "-g", "daemon off;"]
