FROM node:20

# Install 9router globally
RUN npm install -g 9router

# Create data directory for 9router
RUN mkdir -p /root/.9router

# Expose the default 9router port
EXPOSE 20128

# Run 9router and bind to all interfaces. 
# We pipe in "3" (Hide to Tray/Background) or just leave it to run normally.
# Actually, running it directly is fine since the server starts immediately.
CMD ["9router", "-H", "0.0.0.0", "--no-browser"]
