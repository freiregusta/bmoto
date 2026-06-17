import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-foreground/60">Oops! Page not found</p>
        <a href="/" className="text-foreground underline hover:opacity-70 transition-opacity duration-200 uppercase text-sm tracking-wide">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
