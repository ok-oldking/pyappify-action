import os
import sys
import time
from PySide6.QtWidgets import QApplication, QWidget, QVBoxLayout, QLabel, QPushButton
from PySide6.QtCore import QTimer, Qt
from PySide6.QtGui import QIcon

def print_envs():
    print("Environment Variables:")
    for key, value in os.environ.items():
        print(f"{key}={value}")

def run_app(title_suffix):
    print_envs()
    app = QApplication(sys.argv)
    window = QWidget()
    window.setWindowIcon(QIcon("icons/icon.png"))
    window.setWindowTitle(f"PyAppify {title_suffix}")
    window.resize(600, 600)

    layout = QVBoxLayout()
    layout.setAlignment(Qt.AlignCenter)

    hello_label = QLabel("Hello World")
    hello_label.setAlignment(Qt.AlignCenter)

    seconds_label = QLabel("Seconds since start:")
    seconds_label.setAlignment(Qt.AlignCenter)

    exit_button = QPushButton("Exit")

    layout.addWidget(hello_label)
    layout.addWidget(seconds_label)
    layout.addWidget(exit_button, alignment=Qt.AlignCenter)

    window.setLayout(layout)

    start_time = time.time()

    def update_time():
        elapsed_time = int(time.time() - start_time)
        seconds_label.setText(f"Seconds since start: {elapsed_time}")
        print(f"Hello World - Elapsed Seconds: {elapsed_time}")

    exit_button.clicked.connect(window.close)

    timer = QTimer(window)
    timer.setInterval(1000)
    timer.timeout.connect(update_time)
    timer.start()

    window.show()
    sys.exit(app.exec())