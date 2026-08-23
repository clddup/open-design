import { Navigate } from "react-router-dom";

export function NotFoundPage() {
  return <Navigate replace to="/" />;
}
