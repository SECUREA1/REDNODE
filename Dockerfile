# Use Nginx to serve the RedNode HTML page
FROM nginx:alpine

# Copy the application HTML to the container's web root
COPY rednode.html /usr/share/nginx/html/index.html

# Expose default Nginx port
EXPOSE 80

# Use the default Nginx start command
CMD ["nginx", "-g", "daemon off;"]
