# Renders Pawmodoro off-screen with example data and saves a screenshot:
#   env -i HOME=<throwaway> TMPDIR=<throwaway> XDG_RUNTIME_DIR=<throwaway> PATH=<empty dir> \
#     QT_QPA_PLATFORM=offscreen <python with PyQt6> tools/pawmodoro-shot.py <out.png>
# The throwaway HOME keeps your real data.json untouched; the empty PATH and XDG_RUNTIME_DIR keep the
# player bar from reading whatever is playing on your desktop (it must never show real media).
import os, sys
SRC = '/var/home/beef/Desktop/pawmodoro'
sys.path.insert(0, SRC)
os.chdir(SRC)
from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import QTimer
app = QApplication(sys.argv)
from storage import Storage
s = Storage()
s.set_notes("<h3>Store Championship prep</h3><ul><li>Test the Jinx list against Viktor</li><li>Print decklist, sleeve backups</li><li>Pack dice + playmat</li></ul>")
for text, rec, day in [("Walk the dogs", "daily", None), ("Sleeve the new deck", "once", None), ("Log results in Pairings", "daily", None), ("Take out the trash", "weekday", 3)]:
    s.add_task(text, rec, weekday=day)
s.add_xp(620)
from main import MainWindow
w = MainWindow()
w.resize(1100, 700)
w.show()
def grab():
    w.grab().save(sys.argv[1])
    app.quit()
QTimer.singleShot(1500, grab)
app.exec()
