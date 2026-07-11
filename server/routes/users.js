// API de gestión de usuarios (STUB — sin persistencia real todavía).
// Modificar usuario, contraseña, eliminar y permisos.

const express = require('express');
const router = express.Router();

const DEMO_USERS = [
  { id: 1, username: 'admin', role: 'admin', avatar: 1, permissions: ['usuarios', 'mapeos', 'basesdatos'] },
  { id: 2, username: 'operador', role: 'user', avatar: 3, permissions: ['mapeos'] },
];

// GET /api/users
router.get('/', (_req, res) => res.json({ ok: true, stub: true, users: DEMO_USERS }));

// PATCH /api/users/:id       (modificar usuario / permisos)
router.patch('/:id', (req, res) => res.json({ ok: true, stub: true, id: Number(req.params.id), changes: req.body }));

// PATCH /api/users/:id/password
router.patch('/:id/password', (req, res) => res.json({ ok: true, stub: true, id: Number(req.params.id) }));

// DELETE /api/users/:id
router.delete('/:id', (req, res) => res.json({ ok: true, stub: true, id: Number(req.params.id) }));

module.exports = router;
