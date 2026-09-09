"""
TCIDE Pet Component — Native Qt pixel pet rendering
Uses pet_assets images as QPixmap, displays in a QLabel with animation.
"""
from PySide6.QtWidgets import QLabel, QVBoxLayout, QWidget
from PySide6.QtCore import QTimer, Qt, Signal
from PySide6.QtGui import QPixmap, QPainter, QColor
import json
import os
import base64
from io import BytesIO

class TCIDEPet(QWidget):
    """Pixel pet widget that displays animated mascot based on AI state."""
    
    state_changed = Signal(str, str)  # state, label
    
    STATES = {
        'idle': {'label': 'Idle', 'speed': 200},
        'thinking': {'label': 'Thinking...', 'speed': 150},
        'tool': {'label': 'Working...', 'speed': 120},
        'success': {'label': 'Done!', 'speed': 200},
        'error': {'label': 'Oops!', 'speed': 200},
        'run': {'label': 'Running...', 'speed': 100},
        'jump': {'label': 'Jump!', 'speed': 150},
        'review': {'label': 'Reviewing...', 'speed': 180},
    }
    
    def __init__(self, pet_assets_dir, parent=None):
        super().__init__(parent)
        self.pet_assets_dir = pet_assets_dir
        self.current_state = 'idle'
        self.frame_index = 0
        self.images = {}
        self.wandering = False
        self.dr_x, self.dr_y = 0, 0
        self._load_images()
        self._setup_ui()
        
    def _load_images(self):
        """Load pet images from assets directory."""
        manifest_path = os.path.join(self.pet_assets_dir, 'pet_manifest.json')
        if os.path.exists(manifest_path):
            with open(manifest_path, 'r', encoding='utf-8') as f:
                manifest = json.load(f)
            for state, data_uri in manifest.items():
                if data_uri.startswith('data:image/png;base64,'):
                    img_data = base64.b64decode(data_uri.split(',')[1])
                    pixmap = QPixmap()
                    pixmap.loadFromData(img_data)
                    self.images[state] = pixmap
        
        # If no images loaded, create placeholder
        if not self.images:
            self.images['idle'] = self._create_placeholder()
            
    def _create_placeholder(self):
        """Create a placeholder image when assets aren't available."""
        pixmap = QPixmap(64, 64)
        pixmap.fill(QColor(30, 30, 30))
        painter = QPainter(pixmap)
        painter.setPen(QColor(100, 200, 100))
        painter.drawText(pixmap.rect(), Qt.AlignCenter, '🐱')
        painter.end()
        return pixmap
        
    def _setup_ui(self):
        """Setup the widget layout."""
        layout = QVBoxLayout(self)
        layout.setContentsMargins(4, 4, 4, 4)
        
        self.image_label = QLabel()
        self.image_label.setAlignment(Qt.AlignCenter)
        self.image_label.setFixedSize(64, 64)
        layout.addWidget(self.image_label)
        
        self.state_label = QLabel('Idle')
        self.state_label.setAlignment(Qt.AlignCenter)
        self.state_label.setStyleSheet('color: #888; font-size: 10px;')
        layout.addWidget(self.state_label)
        
        # Animation timer
        self.anim_timer = QTimer()
        self.anim_timer.timeout.connect(self._next_frame)
        self.anim_timer.start(200)
        
        # Wander timer
        self.wander_timer = QTimer()
        self.wander_timer.timeout.connect(self._wander)
        self.wander_timer.setSingleShot(True)
        
        self._show_state('idle')
        
    def _next_frame(self):
        """Advance animation frame."""
        speed = self.STATES.get(self.current_state, {}).get('speed', 200)
        self.anim_timer.setInterval(speed)
        
    def _show_state(self, state):
        """Show the specified state."""
        self.current_state = state
        pixmap = self.images.get(state) or self.images.get('idle')
        if pixmap:
            scaled = pixmap.scaled(64, 64, Qt.KeepAspectRatio, Qt.SmoothTransformation)
            self.image_label.setPixmap(scaled)
        
        label = self.STATES.get(state, {}).get('label', state)
        self.state_label.setText(label)
        self.state_changed.emit(state, label)
        
    def set_state(self, state, label=None):
        """Set pet state from external code."""
        if state in self.images or state == 'idle':
            self._show_state(state)
            if label:
                self.state_label.setText(label)
            if state != 'idle':
                # Auto-return to idle after delay
                QTimer.singleShot(2500, lambda: self._show_state('idle'))
    
    def _wander(self):
        """Random movement for idle animation."""
        import random
        if self.wandering and self.current_state in ('idle', 'run'):
            self._show_state('run')
            self.wander_timer.start(1200 + random.random() * 1800)
