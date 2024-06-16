const express = require('express');
const router = express.Router();

const controller = require('../controllers/cron');

router.get('/start', controller.start);
router.get('/info', controller.info);

router.get('/tiktokTest', controller.tiktokTest);
router.get('/tiktokTestDelete', controller.tiktokTestDelete);
router.get('/tiktokTestOne', controller.tiktokTestOne);

router.get('/facebookTest', controller.facebookTest);
router.get('/instagramTest', controller.instagramTest);
router.get('/youtubeTest', controller.youtubeTest);

module.exports = router;
