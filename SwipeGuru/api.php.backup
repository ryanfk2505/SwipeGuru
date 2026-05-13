<?php
/**
 * SwipeGuru Backend REST API (Native PHP PDO)
 */
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST");
header("Access-Control-Allow-Headers: Content-Type");

session_start();

$host = 'localhost';
$db   = 'swipeguru';
$user = 'root';
$pass = '';
$charset = 'utf8mb4';

$dsn = "mysql:host=$host;dbname=$db;charset=$charset";
$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
    $pdo = new PDO($dsn, $user, $pass, $options);
} catch (\PDOException $e) {
    echo json_encode(['error' => 'Connection failed: ' . $e->getMessage()]);
    exit;
}

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'login':
        $data = json_decode(file_get_contents('php://input'), true);
        $stmt = $pdo->prepare("SELECT * FROM users WHERE email = ? AND password = ?");
        $stmt->execute([$data['email'], $data['password']]);
        $user = $stmt->fetch();
        if ($user) {
            $_SESSION['user_id'] = $user['id'];
            echo json_encode(['success' => true, 'user' => $user]);
        } else {
            echo json_encode(['success' => false, 'message' => 'Invalid login']);
        }
        break;

    case 'swipe':
        $userId = $_SESSION['user_id'];
        $data = json_decode(file_get_contents('php://input'), true);
        $stmt = $pdo->prepare("INSERT INTO swipes (swiper_id, swiped_id, direction) VALUES (?, ?, ?)");
        $stmt->execute([$userId, $data['swiped_id'], $data['direction']]);
        
        if ($data['direction'] == 'right') {
            $stmt = $pdo->prepare("SELECT * FROM swipes WHERE swiper_id = ? AND swiped_id = ? AND direction = 'right'");
            $stmt->execute([$data['swiped_id'], $userId]);
            if ($stmt->fetch()) {
                $pdo->prepare("INSERT INTO matches (user1_id, user2_id) VALUES (?, ?)")->execute([$userId, $data['swiped_id']]);
                echo json_encode(['match' => true]);
                exit;
            }
        }
        echo json_encode(['match' => false]);
        break;

    case 'create_booking':
        $userId = $_SESSION['user_id'];
        $data = json_decode(file_get_contents('php://input'), true);
        $stmt = $pdo->prepare("INSERT INTO bookings (murid_id, guru_id, match_id, amount, session_date, status) VALUES (?, ?, ?, ?, ?, 'unpaid')");
        $stmt->execute([$userId, $data['guru_id'], $data['match_id'], $data['amount'], $data['session_date']]);
        echo json_encode(['success' => true]);
        break;

    case 'pay_booking':
        $id = $_GET['id'];
        $pdo->prepare("UPDATE bookings SET status = 'paid' WHERE id = ?")->execute([$id]);
        echo json_encode(['success' => true]);
        break;

    case 'my_bookings':
        $userId = $_SESSION['user_id'];
        $stmt = $pdo->prepare("SELECT b.*, u.full_name as other_name FROM bookings b JOIN users u ON (b.murid_id = u.id OR b.guru_id = u.id) WHERE (b.murid_id = ? OR b.guru_id = ?) AND u.id != ? ORDER BY b.created_at DESC");
        $stmt->execute([$userId, $userId, $userId]);
        echo json_encode($stmt->fetchAll());
        break;

    default:
        echo json_encode(['error' => 'Action not found']);
        break;
}
?>
