import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Login from './pages/Login';
import Register from './pages/Register';
import Canvas from './pages/Canvas';

const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { isAuthenticated } = useAuth();
    return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
};

import AdminPanel from './components/AdminPanel';

const AdminWrapper: React.FC = () => {
    const { user } = useAuth();
    if (user && user.role === 'admin') {
        return <AdminPanel />;
    }
    return null;
};

const App: React.FC = () => {
    return (
        <Router>
            <AuthProvider>
                <ToastContainer position="top-right" autoClose={3000} />
                <AdminWrapper />
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/" element={<Navigate to="/canvas/default" />} />
                    <Route path="/canvas/:id" element={
                        <PrivateRoute>
                            <Canvas />
                        </PrivateRoute>
                    } />
                </Routes>
            </AuthProvider>
        </Router>
    );
};

export default App;
