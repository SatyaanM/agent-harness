import net from "node:net";

/**
 * Finds an available TCP port on the loopback interface (127.0.0.1).
 */
export async function getAvailablePort(preferredPort = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (preferredPort !== 0 && err.code === "EADDRINUSE") {
        // Fall back to any open OS port
        getAvailablePort(0).then(resolve, reject);
      } else {
        reject(err);
      }
    });

    server.listen(preferredPort, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to get port from bound server")));
        return;
      }
      const port = address.port;
      server.close((closeErr) => {
        if (closeErr) reject(closeErr);
        else resolve(port);
      });
    });
  });
}
