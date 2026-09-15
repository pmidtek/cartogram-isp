import psycopg2
from typing import Dict


class DatabaseManager:
    """Shared database connection manager"""
    
    def __init__(self, db_config: Dict[str, str]):
        self.db_config = db_config
        self.connection = None
    
    def connect(self):
        """Create database connection"""
        try:
            self.connection = psycopg2.connect(**self.db_config)
            return True
        except Exception as e:
            print(f"Database connection error: {e}")
            return False
    
    def get_connection(self):
        """Get existing connection or create new one"""
        if not self.connection:
            self.connect()
        return self.connection
    
    def close(self):
        """Close database connection"""
        if self.connection:
            self.connection.close()
            self.connection = None