from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from database import Base


class Camera(Base):
    __tablename__ = "cameras"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    url = Column(String, nullable=False)
    polygon = Column(Text, nullable=True)
    line = Column(Text, nullable=True)

    alerts = relationship("Alert", back_populates="camera", cascade="all, delete")


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id"), nullable=False)
    message = Column(String, nullable=False)
    image_path = Column(String, nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

    camera = relationship("Camera", back_populates="alerts")
