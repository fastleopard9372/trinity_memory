import { Router } from 'express';
import { AuthController } from '../controller/auth.controller';

const router = Router();
const authController = new AuthController();

router.post('/login', authController.login);
router.post('/register', authController.register);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.get('/profile', authController.getProfile);

export default router;